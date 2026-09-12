#!/usr/bin/env python3
"""Generate interop test vectors for the TypeScript OMEMO implementation.

Uses the python-omemo reference stack (xeddsa, x3dh, doubleratchet, oldmemo,
twomemo) installed in packages/omemo/.venv. All key material is derived
deterministically from SHA-256 of fixed labels, so the output is stable.

Usage: .venv/bin/python scripts/gen_vectors.py
Writes: test/interop/vectors.json
"""

import asyncio
import hashlib
import hmac as hmaclib
import json
import secrets
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import xeddsa
import x3dh
import x3dh.identity_key_pair as ikp
import doubleratchet
from doubleratchet.recommended import diffie_hellman_ratchet_curve25519 as dh_curve
import oldmemo.oldmemo as old
import oldmemo.etree as old_etree
import oldmemo.oldmemo_pb2 as oldpb
import twomemo.twomemo as two
import twomemo.etree as two_etree
import twomemo.twomemo_pb2 as twopb
from omemo.message import Message as OmemoMessageStruct

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import hashes, hmac as chmac
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

OUT = Path(__file__).resolve().parent.parent / "test" / "interop" / "vectors.json"


def det(label: str) -> bytes:
    """Deterministic 32 bytes of key material from a label."""
    return hashlib.sha256(b"omemo-interop-v1:" + label.encode()).digest()


def det_bytes(label: str, n: int) -> bytes:
    out = b""
    i = 0
    while len(out) < n:
        out += hashlib.sha256(det(label) + i.to_bytes(4, "little")).digest()
        i += 1
    return out[:n]


def hx(b) -> str:
    if isinstance(b, memoryview):
        b = bytes(b)
    return bytes(b).hex()


# ---------------------------------------------------------------------------
# monkeypatching helpers: deterministic secrets for the reference stack
# ---------------------------------------------------------------------------

class DeterministicRandom:
    """Patches secrets.token_bytes / secrets.choice to return fixed values."""

    def __init__(self):
        self.queue = []
        self._orig_tb = None
        self._orig_choice = None

    def feed(self, data: bytes):
        self.queue.append(data)

    def __enter__(self):
        self._orig_tb = secrets.token_bytes
        self._orig_choice = secrets.choice
        queue = self.queue

        def token_bytes(n):
            if not queue:
                raise AssertionError("deterministic random queue exhausted")
            v = queue.pop(0)
            assert len(v) == n, f"wanted {n} bytes, queued {len(v)}"
            return v

        secrets.token_bytes = token_bytes
        secrets.choice = lambda seq: seq[0]
        return self

    def __exit__(self, *exc):
        secrets.token_bytes = self._orig_tb
        secrets.choice = self._orig_choice
        return False


class FixedRatchet(dh_curve.DiffieHellmanRatchet):
    """DiffieHellmanRatchet with injected key generation order."""

    _queue = []

    @staticmethod
    def _generate_priv() -> bytes:
        if not FixedRatchet._queue:
            raise AssertionError("ratchet key queue exhausted")
        return FixedRatchet._queue.pop(0)


def curve_pub(priv: bytes) -> bytes:
    return xeddsa.priv_to_curve25519_pub(priv)


# ---------------------------------------------------------------------------
# 1. XEdDSA / key conversion vectors
# ---------------------------------------------------------------------------

def xeddsa_vectors():
    msg = b"OMEMO interoperability test message"
    nonce = det_bytes("xeddsa-nonce", 64)
    out = {"message": hx(msg), "nonce": hx(nonce), "cases": []}
    for i in range(4):
        seed = det(f"xeddsa-seed-{i}")
        priv = xeddsa.seed_to_priv(seed)
        cpub = xeddsa.priv_to_curve25519_pub(priv)
        epub = xeddsa.priv_to_ed25519_pub(priv)
        sig = xeddsa.ed25519_priv_sign(priv, msg, nonce)
        sign_bit = (epub[31] >> 7) & 1
        # on the wire the sign bit is smuggled into the top bit of the
        # signature, see oldmemo etree.serialize_bundle / parse_bundle
        sig_wire = bytearray(sig)
        sig_wire[63] |= sign_bit << 7
        # priv_force_sign outputs for both target bit values
        forced0 = xeddsa.priv_force_sign(priv, False)
        forced1 = xeddsa.priv_force_sign(priv, True)
        out["cases"].append({
            "seed": hx(seed),
            "priv": hx(priv),
            "curvePub": hx(cpub),
            "edPub": hx(epub),
            "signature": hx(bytes(sig_wire)),
            "signatureRaw": hx(sig),
            "signBit": sign_bit,
            "forcedSign0": hx(forced0),
            "forcedSign1": hx(forced1),
            "forcedSign0CurvePub": hx(curve_pub(forced0)),
            "forcedSign1CurvePub": hx(curve_pub(forced1)),
        })
    return out


def x25519_vectors():
    privs = [det(f"x25519-priv-{i}") for i in range(4)]
    pubs = [xeddsa.priv_to_curve25519_pub(p) for p in privs]
    cases = []
    for i in range(4):
        for j in range(4):
            if i == j:
                continue
            cases.append({
                "priv": hx(privs[i]),
                "pub": hx(pubs[j]),
                "shared": hx(xeddsa.x25519(privs[i], pubs[j])),
            })
    return {
        "privs": [hx(p) for p in privs],
        "pubs": [hx(p) for p in pubs],
        "cases": cases,
    }


def ed_curve_vectors():
    cases = []
    for i in range(4):
        seed = det(f"ed2curve-seed-{i}")
        priv = xeddsa.seed_to_priv(seed)
        epub = xeddsa.seed_to_ed25519_pub(seed)
        cpub = xeddsa.ed25519_pub_to_curve25519_pub(epub)
        cases.append({
            "seed": hx(seed),
            "edPub": hx(epub),
            "curvePub": hx(cpub),
            "curvePriv": hx(priv),
            "wire": hx(b"\x05" + cpub),
            "edFromCurveSign0": hx(xeddsa.curve25519_pub_to_ed25519_pub(cpub, False)),
            "edFromCurveSign1": hx(xeddsa.curve25519_pub_to_ed25519_pub(cpub, True)),
        })
    return {"cases": cases}


# ---------------------------------------------------------------------------
# 2. X3DH through the real x3dh library, with injected key material
# ---------------------------------------------------------------------------

class LegacyState(x3dh.BaseState):
    _encode_public_key = staticmethod(old.StateImpl._encode_public_key)


class Omemo2State(x3dh.BaseState):
    _encode_public_key = staticmethod(two.StateImpl._encode_public_key)


def x3dh_case(state_cls, info, label):
    """Run one X3DH agreement with fully fixed key material."""
    ik_a_seed = det(f"{label}-ik-a-seed")
    ik_b_seed = det(f"{label}-ik-b-seed")
    ik_a_priv = xeddsa.seed_to_priv(ik_a_seed)
    ik_b_priv = xeddsa.seed_to_priv(ik_b_seed)
    spk_priv = det(f"{label}-spk")
    pk_priv = det(f"{label}-pk")
    ek_priv = det(f"{label}-ek")

    rng = DeterministicRandom()
    with rng:
        # create() consumes token_bytes(32) for the signed pre key and
        # token_bytes(64) for the signature nonce inside ed25519_priv_sign
        rng.feed(spk_priv)
        rng.feed(det_bytes(f"{label}-spk-b-sig-nonce", 64))
        bob = state_cls.create(
            x3dh.IdentityKeyFormat.ED_25519,
            x3dh.HashFunction.SHA_256,
            info,
            ikp.IdentityKeyPairPriv(ik_b_priv),
        )
        rng.feed(pk_priv)
        bob.generate_pre_keys(1)

        # alice's state generates its own signed pre key internally
        rng.feed(det(f"{label}-spk-a"))
        rng.feed(det_bytes(f"{label}-spk-a-sig-nonce", 64))
        alice = state_cls.create(
            x3dh.IdentityKeyFormat.ED_25519,
            x3dh.HashFunction.SHA_256,
            info,
            ikp.IdentityKeyPairPriv(ik_a_priv),
        )

        async def run():
            # active side consumes one token_bytes(32) for the ephemeral key
            rng.feed(ek_priv)
            sk, ad, header = await alice.get_shared_secret_active(
                bob.bundle, require_pre_key=True
            )
            sk_p, ad_p, spk_pair = await bob.get_shared_secret_passive(
                header, require_pre_key=True
            )
            assert sk == sk_p and ad == ad_p
            return sk, ad, header, spk_pair

        sk, ad, header, spk_pair = asyncio.run(run())

    bundle = bob.bundle
    return {
        "identityA": {
            "seed": hx(ik_a_seed),
            "priv": hx(ik_a_priv),
            "edPub": hx(xeddsa.priv_to_ed25519_pub(ik_a_priv)),
            "curvePub": hx(curve_pub(ik_a_priv)),
        },
        "identityB": {
            "seed": hx(ik_b_seed),
            "priv": hx(ik_b_priv),
            "edPub": hx(xeddsa.priv_to_ed25519_pub(ik_b_priv)),
            "curvePub": hx(curve_pub(ik_b_priv)),
        },
        "ephemeral": {"priv": hx(ek_priv), "pub": hx(curve_pub(ek_priv))},
        "signedPreKey": {
            "id": 42,
            "priv": hx(spk_priv),
            "pub": hx(curve_pub(spk_priv)),
            "sig": hx(bundle.signed_pre_key_sig),
        },
        "preKey": {"id": 7, "priv": hx(pk_priv), "pub": hx(curve_pub(pk_priv))},
        "sharedSecret": hx(sk),
        "associatedData": hx(ad),
        "header": {
            "identityKey": hx(header.identity_key),
            "ephemeralKey": hx(header.ephemeral_key),
            "signedPreKey": hx(header.signed_pre_key),
            "preKey": hx(header.pre_key),
        },
    }


# ---------------------------------------------------------------------------
# 3. Double ratchet vectors through the real doubleratchet library
# ---------------------------------------------------------------------------

def dr_model(dr):
    """DoubleRatchet model as JSON-safe dict with all bytes hex encoded."""
    m = dr.model
    dhr = m.diffie_hellman_ratchet

    def chain(c):
        return None if c is None else {"length": c.length, "key": c.key.hex()}

    skr = dhr.symmetric_key_ratchet
    return {
        "ownRatchetPriv": dhr.own_ratchet_priv.hex(),
        "otherRatchetPub": dhr.other_ratchet_pub.hex(),
        "rootChain": chain(dhr.root_chain),
        "sendingChain": chain(skr.sending_chain),
        "receivingChain": chain(skr.receiving_chain),
        "previousSendingChainLength": skr.previous_sending_chain_length,
        "skippedMessageKeys": [
            {
                "ratchetPub": k.ratchet_pub.hex(),
                "index": k.index,
                "messageKey": k.message_key.hex(),
            }
            for k in m.skipped_message_keys
        ],
    }


def em_wire(em):
    return {
        "header": {
            "ratchetPub": hx(em.header.ratchet_pub),
            "pn": em.header.previous_sending_chain_length,
            "n": em.header.sending_chain_length,
        },
        "ciphertext": hx(em.ciphertext),
    }


def ratchet_case(backend, label, sk_hex, ad_hex):
    """Alice encrypts 3 messages, Bob decrypts, Bob replies, Alice decrypts."""
    sk = bytes.fromhex(sk_hex)
    ad = bytes.fromhex(ad_hex)
    spk_priv = bytes.fromhex(det(f"{label}-spk").hex())
    spk_pub = curve_pub(spk_priv)
    ratchet_a = det(f"{label}-ratchet-a")
    ratchet_b = det(f"{label}-ratchet-b")
    ratchet_a_next = det(f"{label}-ratchet-a-next")

    msgs = [f"{label} message {i}".encode() for i in range(3)]
    reply = f"{label} reply".encode()

    async def run():
        FixedRatchet._queue = [ratchet_a]
        dr_a, em1 = await backend.DoubleRatchetImpl.encrypt_initial_message(
            FixedRatchet,
            backend.RootChainKDFImpl,
            backend.MessageChainKDFImpl,
            backend.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
            1000,
            1000,
            backend.AEADImpl,
            sk,
            spk_pub,
            msgs[0],
            ad,
        )
        em2 = await dr_a.encrypt_message(msgs[1], ad)
        em3 = await dr_a.encrypt_message(msgs[2], ad)
        alice_model_mid = dr_model(dr_a)

        FixedRatchet._queue = [ratchet_b]
        dr_b, pt1 = await backend.DoubleRatchetImpl.decrypt_initial_message(
            FixedRatchet,
            backend.RootChainKDFImpl,
            backend.MessageChainKDFImpl,
            backend.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
            1000,
            1000,
            backend.AEADImpl,
            sk,
            spk_priv,
            em1,
            ad,
        )
        assert pt1 == msgs[0]
        assert await dr_b.decrypt_message(em2, ad) == msgs[1]
        assert await dr_b.decrypt_message(em3, ad) == msgs[2]
        # The legacy profile rebuilds the associated data as
        # sender identity || recipient identity for every message. Bob's
        # session is passive, so encrypting his reply swaps the halves.
        # The omemo2 profile keeps the X3DH order unchanged.
        ik_len = 33 if label == "legacy" else 32
        reply_ad = ad[ik_len:] + ad[:ik_len] if label == "legacy" else ad
        em_reply = await dr_b.encrypt_message(reply, reply_ad)
        bob_model_final = dr_model(dr_b)
        bob_model_final = dr_model(dr_b)

        # out of order variant: a second bob DR that sees em1 then em3,
        # leaving the message key for index 1 in the skipped key store
        FixedRatchet._queue = [ratchet_b]
        dr_b2, _ = await backend.DoubleRatchetImpl.decrypt_initial_message(
            FixedRatchet,
            backend.RootChainKDFImpl,
            backend.MessageChainKDFImpl,
            backend.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
            1000,
            1000,
            backend.AEADImpl,
            sk,
            spk_priv,
            em1,
            ad,
        )
        assert await dr_b2.decrypt_message(em3, ad) == msgs[2]
        bob_model_ooo = dr_model(dr_b2)
        assert await dr_b2.decrypt_message(em2, ad) == msgs[1]

        # alice's DH ratchet on the reply generates a fresh ratchet key
        FixedRatchet._queue = [ratchet_a_next]
        assert await dr_a.decrypt_message(em_reply, reply_ad) == reply
        alice_model_final = dr_model(dr_a)

        return {
            "aliceRatchet": {"priv": hx(ratchet_a), "pub": hx(curve_pub(ratchet_a))},
            "bobRatchet": {"priv": hx(ratchet_b), "pub": hx(curve_pub(ratchet_b))},
            "aliceRatchetNext": {
                "priv": hx(ratchet_a_next), "pub": hx(curve_pub(ratchet_a_next))
            },
            "aliceToBob": [
                {"plaintext": hx(msgs[0]), "wire": em_wire(em1)},
                {"plaintext": hx(msgs[1]), "wire": em_wire(em2)},
                {"plaintext": hx(msgs[2]), "wire": em_wire(em3)},
            ],
            "bobReply": {"plaintext": hx(reply), "wire": em_wire(em_reply)},
            "aliceModelAfterSend3": alice_model_mid,
            "aliceModelFinal": alice_model_final,
            "bobModelFinal": bob_model_final,
            "bobModelOutOfOrder": bob_model_ooo,
        }

    return asyncio.run(run())


# ---------------------------------------------------------------------------
# 4. OMEMO wire elements
# ---------------------------------------------------------------------------

def wire_elements(x3dh_legacy, x3dh_omemo2, ratchet_legacy, ratchet_omemo2):
    """Assemble reference <encrypted> elements for both profiles."""
    out = {}

    # -- legacy: message with a plain (non-kex) key + kex key ---------------
    sid = 0x1234ABCD
    rid = 0x0BADCAFE
    bare_jid = "bob@example.org"
    sender_jid = "alice@example.org"

    payload_key = det("legacy-payload-key")[:16]
    payload_iv = det("legacy-iv")[:12]
    plaintext = b"Hello from the reference implementation"
    cipher = Cipher(algorithms.AES(payload_key), modes.GCM(payload_iv)).encryptor()
    payload_ct = cipher.update(plaintext) + cipher.finalize()
    gcm_tag = cipher.tag

    # key material the ratchet encrypts: key || tag
    km = payload_key + gcm_tag

    # reuse the legacy ratchet session: encrypt km as a 4th alice message
    sk = bytes.fromhex(x3dh_legacy["sharedSecret"])
    ad = bytes.fromhex(x3dh_legacy["associatedData"])
    spk_pub = bytes.fromhex(x3dh_legacy["signedPreKey"]["pub"])
    ratchet_a = bytes.fromhex(ratchet_legacy["aliceRatchet"]["priv"])
    ratchet_b = bytes.fromhex(ratchet_legacy["bobRatchet"]["priv"])
    spk_priv = bytes.fromhex(x3dh_legacy["signedPreKey"]["priv"])

    async def legacy_msg():
        FixedRatchet._queue = [ratchet_a]
        dr_a, em1 = await old.DoubleRatchetImpl.encrypt_initial_message(
            FixedRatchet, old.RootChainKDFImpl, old.MessageChainKDFImpl,
            old.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT, 1000, 1000,
            old.AEADImpl, sk, spk_pub, km, ad)
        # Bob side to produce a real kex key too
        FixedRatchet._queue = [ratchet_b]
        dr_b, pt = await old.DoubleRatchetImpl.decrypt_initial_message(
            FixedRatchet, old.RootChainKDFImpl, old.MessageChainKDFImpl,
            old.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT, 1000, 1000,
            old.AEADImpl, sk, spk_priv, em1, ad)
        assert pt == km
        return em1

    em1 = asyncio.run(legacy_msg())

    header = x3dh.Header(
        identity_key=bytes.fromhex(x3dh_legacy["identityA"]["edPub"]),
        ephemeral_key=bytes.fromhex(x3dh_legacy["ephemeral"]["pub"]),
        pre_key=bytes.fromhex(x3dh_legacy["preKey"]["pub"]),
        signed_pre_key=spk_pub,
    )
    kex = old.KeyExchangeImpl(header, 42, 7)
    ekm = old.EncryptedKeyMaterialImpl(bare_jid, rid, em1)

    # plain (post-kex) message: em from a second encrypt
    async def legacy_msg2():
        FixedRatchet._queue = [ratchet_a]
        dr_a, _e = await old.DoubleRatchetImpl.encrypt_initial_message(
            FixedRatchet, old.RootChainKDFImpl, old.MessageChainKDFImpl,
            old.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT, 1000, 1000,
            old.AEADImpl, sk, spk_pub, km, ad)
        return await dr_a.encrypt_message(b"second key material block padded..", ad)

    em2 = asyncio.run(legacy_msg2())
    ekm2 = old.EncryptedKeyMaterialImpl(bare_jid, rid + 1, em2)

    msg = OmemoMessageStruct(
        namespace=old.NAMESPACE,
        bare_jid=bare_jid,
        device_id=sid,
        content=old.ContentImpl(payload_ct, payload_iv),
        keys=frozenset([(ekm, kex), (ekm2, None)]),
    )
    ET.register_namespace("", old.NAMESPACE)
    elt = old_etree.serialize_message(msg)
    # message.keys is a frozenset; sort <key> children by rid for stable output
    header_elt = elt.find(f"{{{old.NAMESPACE}}}header")
    key_elts = [c for c in header_elt if c.tag == f"{{{old.NAMESPACE}}}key"]
    for c in key_elts:
        header_elt.remove(c)
    # reinsert before the <iv> element, sorted by rid
    iv_elt = header_elt.find(f"{{{old.NAMESPACE}}}iv")
    iv_index = list(header_elt).index(iv_elt)
    for c in sorted(key_elts, key=lambda e: int(e.get("rid"))):
        header_elt.insert(iv_index, c)
        iv_index += 1
    out["legacy"] = {
        "xml": ET.tostring(elt, encoding="unicode"),
        "sid": sid,
        "rids": [rid, rid + 1],
        "iv": hx(payload_iv),
        "payloadKey": hx(payload_key),
        "payloadTag": hx(gcm_tag),
        "payloadCiphertext": hx(payload_ct),
        "plaintext": hx(plaintext),
    }

    # -- omemo2: message with a kex key --------------------------------------
    sid2 = 0x0FEDCBA9
    rid2 = 0x00C0FFEE
    payload_key2 = det("omemo2-payload-key")
    pt2 = b"<envelope xmlns='urn:xmpp:sce:1'><content><body>hi</body></content></envelope>"
    km2 = payload_key2  # 32 byte key, auth tag appended after hkdf
    key_material = HKDF(
        algorithm=hashes.SHA256(), length=80, salt=b"\x00" * 32,
        info=b"OMEMO Payload").derive(km2)
    enc_key, auth_key, iv2 = key_material[:32], key_material[32:64], key_material[64:]
    c2 = Cipher(algorithms.AES(enc_key), modes.CBC(iv2)).encryptor()
    pad_len = 16 - (len(pt2) % 16)
    padded = pt2 + bytes([pad_len]) * pad_len
    ct2 = c2.update(padded) + c2.finalize()
    h = chmac.HMAC(auth_key, hashes.SHA256())
    h.update(ct2)
    tag2 = h.finalize()[:16]

    sk2 = bytes.fromhex(x3dh_omemo2["sharedSecret"])
    ad2 = bytes.fromhex(x3dh_omemo2["associatedData"])
    spk_pub2 = bytes.fromhex(x3dh_omemo2["signedPreKey"]["pub"])
    ratchet_a2 = bytes.fromhex(ratchet_omemo2["aliceRatchet"]["priv"])

    async def omemo2_msg():
        FixedRatchet._queue = [ratchet_a2]
        dr_a, em = await two.DoubleRatchetImpl.encrypt_initial_message(
            FixedRatchet, two.RootChainKDFImpl, two.MessageChainKDFImpl,
            two.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT, 1000, 1000,
            two.AEADImpl, sk2, spk_pub2, km2 + tag2, ad2)
        return em

    em_o2 = asyncio.run(omemo2_msg())

    header2 = x3dh.Header(
        identity_key=bytes.fromhex(x3dh_omemo2["identityA"]["edPub"]),
        ephemeral_key=bytes.fromhex(x3dh_omemo2["ephemeral"]["pub"]),
        pre_key=bytes.fromhex(x3dh_omemo2["preKey"]["pub"]),
        signed_pre_key=spk_pub2,
    )
    kex2 = two.KeyExchangeImpl(header2, 42, 7)
    ekm_o2 = two.EncryptedKeyMaterialImpl(bare_jid, rid2, em_o2)
    msg2 = OmemoMessageStruct(
        namespace=two.NAMESPACE,
        bare_jid=bare_jid,
        device_id=sid2,
        content=two.ContentImpl(ct2),
        keys=frozenset([(ekm_o2, kex2)]),
    )
    ET.register_namespace("", two.NAMESPACE)
    elt2 = two_etree.serialize_message(msg2)
    out["omemo2"] = {
        "xml": ET.tostring(elt2, encoding="unicode"),
        "sid": sid2,
        "rid": rid2,
        "jid": bare_jid,
        "payloadKey": hx(payload_key2),
        "payloadTag": hx(tag2),
        "payloadCiphertext": hx(ct2),
        "plaintext": hx(pt2),
    }

    # -- golden bundle elements ----------------------------------------------
    for name, state_cls, etree_mod, ns, label in [
        ("legacy", LegacyState, old_etree, old.NAMESPACE, "legacy"),
        ("omemo2", Omemo2State, two_etree, two.NAMESPACE, "omemo2"),
    ]:
        b_ik_seed = det(f"{label}-ik-b-seed")
        b_ik_priv = xeddsa.seed_to_priv(b_ik_seed)
        spk_priv_l = det(f"{label}-spk")
        pk_priv_l = det(f"{label}-pk")
        rng = DeterministicRandom()
        with rng:
            rng.feed(spk_priv_l)
            rng.feed(det_bytes(f"{label}-spk-bundle-sig-nonce", 64))
            st = state_cls.create(
                x3dh.IdentityKeyFormat.ED_25519,
                x3dh.HashFunction.SHA_256,
                state_cls.INFO if hasattr(state_cls, "INFO") else (
                    old.StateImpl.INFO if name == "legacy" else two.StateImpl.INFO),
                ikp.IdentityKeyPairPriv(b_ik_priv),
            )
            rng.feed(pk_priv_l)
            st.generate_pre_keys(1)
        bundle_cls = old.BundleImpl if name == "legacy" else two.BundleImpl
        b = bundle_cls(
            bare_jid=bare_jid, device_id=sid,
            bundle=st.bundle,
            signed_pre_key_id=42,
            pre_key_ids={curve_pub(pk_priv_l): 7},
        )
        belt = etree_mod.serialize_bundle(b)
        ET.register_namespace("", ns)
        out[f"{name}Bundle"] = {"xml": ET.tostring(belt, encoding="unicode")}

    return out


# ---------------------------------------------------------------------------
# 5. Golden protobuf wire bytes per profile
# ---------------------------------------------------------------------------

def golden_protos():
    """Serialize each proto structure with the reference implementation.

    Note the legacy profile uses a different field numbering than omemo2:
    legacy OMEMOMessage is dh_pub=1, n=2, pn=3, ciphertext=4 (the Signal
    message layout), while omemo2 uses n=1, pn=2, dh_pub=3, ciphertext=4.
    Legacy OMEMOKeyExchange is pk_id=1, ek=2, ik=3, message=4, spk_id=6 while
    omemo2 uses pk_id=1, spk_id=2, ik=3, ek=4, message=5.
    """
    dh33 = b"\x05" + det("golden-dh")
    dh32 = det("golden-dh-32")
    ct = det_bytes("golden-ciphertext", 48)
    mac16 = det("golden-mac")[:16]
    mac8 = det("golden-mac-8")[:8]
    ik33 = b"\x05" + det("golden-ik")
    ik32 = det("golden-ik-32")
    ek33 = b"\x05" + det("golden-ek")
    ek32 = det("golden-ek-32")
    inner = det_bytes("golden-inner", 40)

    legacy_msg = oldpb.OMEMOMessage(n=5, pn=2, dh_pub=dh33, ciphertext=ct).SerializeToString()
    omemo2_msg = twopb.OMEMOMessage(n=5, pn=2, dh_pub=dh32, ciphertext=ct).SerializeToString()

    legacy_auth = old.OMEMOAuthenticatedMessage(mac=mac8, message=b"\x33" + legacy_msg).SerializeToString()
    omemo2_auth = twopb.OMEMOAuthenticatedMessage(
        mac=mac16, message=omemo2_msg).SerializeToString()

    legacy_kex = b"\x33" + oldpb.OMEMOKeyExchange(
        pk_id=7, spk_id=42, ik=ik33, ek=ek33, message=inner).SerializeToString()
    omemo2_kex = twopb.OMEMOKeyExchange(
        pk_id=7, spk_id=42, ik=ik32, ek=ek32,
        message=twopb.OMEMOAuthenticatedMessage(mac=mac16, message=omemo2_msg)
    ).SerializeToString()

    return {
        "fields": {
            "n": 5, "pn": 2, "pkId": 7, "spkId": 42,
            "dhPub": hx(dh32), "dhPubWire33": hx(dh33),
            "ciphertext": hx(ct), "mac16": hx(mac16), "mac8": hx(mac8),
            "ik32": hx(ik32), "ik33": hx(ik33),
            "ek32": hx(ek32), "ek33": hx(ek33),
            "kexMessage": hx(omemo2_auth), "inner": hx(inner),
        },
        "legacy": {
            "omemoMessage": hx(legacy_msg),
            "authenticatedMessage": hx(legacy_auth),
            "keyExchange": hx(legacy_kex),
        },
        "omemo2": {
            "omemoMessage": hx(omemo2_msg),
            "authenticatedMessage": hx(omemo2_auth),
            "keyExchange": hx(omemo2_kex),
        },
    }


# ---------------------------------------------------------------------------
# 6. HKDF / AES vectors
# ---------------------------------------------------------------------------

def hkdf_vectors():
    # RFC 5869 test cases 1-3 (SHA-256)
    cases = [
        {
            "ikm": "0b" * 22,
            "salt": "000102030405060708090a0b0c",
            "info": "f0f1f2f3f4f5f6f7f8f9",
            "length": 42,
        },
        {
            "ikm": "000102030405060708090a0b0c0d0e0f"
                   "101112131415161718191a1b1c1d1e1f"
                   "202122232425262728292a2b2c2d2e2f"
                   "303132333435363738393a3b3c3d3e3f"
                   "404142434445464748494a4b4c4d4e4f",
            "salt": "606162636465666768696a6b6c6d6e6f"
                    "707172737475767778797a7b7c7d7e7f"
                    "808182838485868788898a8b8c8d8e8f"
                    "909192939495969798999a9b9c9d9e9f",
            "info": "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
                    "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf"
                    "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf"
                    "e0e1e2e3e4e5e6e7e8e9eaebecedeeef",
            "length": 82,
        },
        {
            "ikm": "0b" * 22,
            "salt": "",
            "info": "",
            "length": 42,
        },
    ]
    for c in cases:
        salt = bytes.fromhex(c["salt"]) or b"\x00" * 32
        okm = HKDF(
            algorithm=hashes.SHA256(),
            length=c["length"],
            salt=salt,
            info=bytes.fromhex(c["info"]),
        ).derive(bytes.fromhex(c["ikm"]))
        c["okm"] = okm.hex()
        c["salt"] = salt.hex()
    return {"cases": cases}


def aes_vectors():
    out = {"cbc": [], "gcm": []}
    for i in range(2):
        key = det(f"aes-cbc-key-{i}")
        iv = det(f"aes-cbc-iv-{i}")[:16]
        pt = det_bytes(f"aes-cbc-pt-{i}", 33 + i * 17)
        pad_len = 16 - (len(pt) % 16)
        padded = pt + bytes([pad_len]) * pad_len
        enc = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
        ct = enc.update(padded) + enc.finalize()
        out["cbc"].append({
            "key": hx(key), "iv": hx(iv),
            "plaintext": hx(pt), "ciphertext": hx(ct),
        })
    for i in range(2):
        key = det(f"aes-gcm-key-{i}")[:16]
        iv = det(f"aes-gcm-iv-{i}")[:12]
        pt = det_bytes(f"aes-gcm-pt-{i}", 40 + i * 23)
        enc = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
        ct = enc.update(pt) + enc.finalize()
        out["gcm"].append({
            "key": hx(key), "iv": hx(iv),
            "plaintext": hx(pt),
            "ciphertext": hx(ct), "tag": hx(enc.tag),
        })
    return out


def main():
    vectors = {
        "xeddsa": xeddsa_vectors(),
        "x25519": x25519_vectors(),
        "edCurve": ed_curve_vectors(),
        "x3dh": {
            "legacy": x3dh_case(LegacyState, old.StateImpl.INFO, "legacy"),
            "omemo2": x3dh_case(Omemo2State, two.StateImpl.INFO, "omemo2"),
        },
        "hkdf": hkdf_vectors(),
        "aes": aes_vectors(),
        "protos": golden_protos(),
    }

    vectors["ratchet"] = {
        "legacy": ratchet_case(
            old, "legacy",
            vectors["x3dh"]["legacy"]["sharedSecret"],
            vectors["x3dh"]["legacy"]["associatedData"]),
        "omemo2": ratchet_case(
            two, "omemo2",
            vectors["x3dh"]["omemo2"]["sharedSecret"],
            vectors["x3dh"]["omemo2"]["associatedData"]),
    }

    vectors["wire"] = wire_elements(
        vectors["x3dh"]["legacy"], vectors["x3dh"]["omemo2"],
        vectors["ratchet"]["legacy"], vectors["ratchet"]["omemo2"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(vectors, indent=1))
    print(f"wrote {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
