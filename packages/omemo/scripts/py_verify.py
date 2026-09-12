#!/usr/bin/env python3
"""One-shot verification bridge for the TypeScript OMEMO interop tests.

Reads a JSON request on stdin, performs an operation with the python-omemo
reference stack, writes a JSON result on stdout. All byte strings are hex.

Request: {"op": <name>, ...operation specific hex fields}

Operations:
  xeddsa_verify       {edPub, msg, sig} -> {valid}
  xeddsa_verify_curve {curvePub, signBit, msg, sig} -> {valid, edPub}
  x25519              {priv, pub} -> {shared}
  x3dh_passive        {profile, ikPriv, spkPriv, pkPriv?, header:{ikEdPub, ek,
                      spkPub, pkPub?}} -> {sharedSecret, associatedData}
  dr_decrypt          {profile, model, wire:{ratchetPub,pn,n,ciphertext}, ad}
                      -> {plaintext, model}
  dr_encrypt          {profile, model, plaintext, ad, ratchetPriv?}
                      -> {wire, model}
  dr_init_active      {profile, sharedSecret, recipientRatchetPub, plaintext,
                      ad, ratchetPriv?} -> {wire, model}
  dr_init_passive     {profile, sharedSecret, ownRatchetPriv, wire, ad,
                      ratchetPriv?} -> {plaintext, model}
  kex_build           {profile, ikPriv, bundleXml, bundleJid, bundleDeviceId,
                      plaintext, ekPriv?, ratchetPriv?}
                      -> {kexData, sharedSecret, associatedData, model, spkId,
                          pkId}
  kex_accept          {profile, kexData, ikPriv, spkPriv, pkPriv?, ikSignBit?,
                      ratchetPriv?}
                      -> {plaintext, model, sharedSecret, associatedData,
                          spkId, pkId}
  msg_encrypt         {profile, plaintext, senderJid, sid, recipientJid, rid,
                      session:{model, ad} | x3dh:{ikPriv, bundleXml,
                      bundleJid, bundleDeviceId, ekPriv?, ratchetPriv?},
                      payloadKey?}
                      -> {xml, model, wasKex, sharedSecret?, associatedData?}
  msg_decrypt         {profile, xml, deviceId, ownJid, senderJid,
                      session:{model, ad} | x3dh:{ikPriv, spkPriv, pkPriv?,
                      ikSignBit?, ratchetPriv?}}
                      -> {plaintext|null, model, ad, wasKex, sid}
  bundle_serialize    {profile, ikPriv, spkPriv, spkId, pkPrivs, pkIds, jid,
                      deviceId} -> {xml}
  bundle_parse        {profile, xml, jid, deviceId}
                      -> {identityKey, signedPreKey, signedPreKeySignature,
                          signedPreKeyId, preKeys:{pubHex: id}}

Ratchet sessions are passed around as serialized DoubleRatchetModel JSON, the
same shape gen_vectors.py dumps into vectors.json.
"""

import asyncio
import base64
import hashlib
import json
import secrets
import sys
import xml.etree.ElementTree as ET

import xeddsa
import x3dh
import x3dh.identity_key_pair as ikp
import doubleratchet
from doubleratchet.models import (
    DoubleRatchetModel,
    DiffieHellmanRatchetModel,
    SymmetricKeyRatchetModel,
    KDFChainModel,
    SkippedMessageKeyModel,
)
from doubleratchet.recommended import diffie_hellman_ratchet_curve25519 as dh_curve
import oldmemo.oldmemo as old
import oldmemo.etree as old_etree
import twomemo.twomemo as two
import twomemo.etree as two_etree
from omemo.message import Message as OmemoMessageStruct

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import hashes, hmac as chmac
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

BACKENDS = {"legacy": old, "omemo2": two}
ETREE = {"legacy": old_etree, "omemo2": two_etree}
NAMESPACES = {"legacy": old.NAMESPACE, "omemo2": two.NAMESPACE}


class LegacyState(x3dh.BaseState):
    _encode_public_key = staticmethod(old.StateImpl._encode_public_key)


class Omemo2State(x3dh.BaseState):
    _encode_public_key = staticmethod(two.StateImpl._encode_public_key)


STATE_CLASSES = {"legacy": (LegacyState, old.StateImpl.INFO),
                 "omemo2": (Omemo2State, two.StateImpl.INFO)}


def unhex(s):
    return bytes.fromhex(s) if s is not None else None


def curve_pub(priv: bytes) -> bytes:
    return xeddsa.priv_to_curve25519_pub(priv)


def det_nonce(label: bytes) -> bytes:
    """Deterministic 64 byte nonce for the reference XEdDSA signer."""
    return hashlib.sha256(b"nonce:" + label).digest() + \
        hashlib.sha256(b"nonce2:" + label).digest()


def make_state(profile, ik_priv, spk_priv, pk_privs):
    """Create a reference X3DH state with fully injected key material.

    state.create() consumes token_bytes(32) for the signed pre key, then
    token_bytes(64) for the signature nonce. Each generated pre key consumes
    another token_bytes(32).
    """
    state_cls, info = STATE_CLASSES[profile]
    orig_tb = secrets.token_bytes
    queue = [unhex(spk_priv), det_nonce(unhex(spk_priv))]
    queue += [unhex(p) for p in pk_privs]
    try:
        secrets.token_bytes = lambda n: queue.pop(0)
        state = state_cls.create(
            x3dh.IdentityKeyFormat.ED_25519,
            x3dh.HashFunction.SHA_256,
            info,
            ikp.IdentityKeyPairPriv(unhex(ik_priv)),
        )
        if pk_privs:
            state.generate_pre_keys(len(pk_privs))
    finally:
        secrets.token_bytes = orig_tb
    return state


def make_dhratchet_class(ratchet_priv_hex):
    class Fixed(dh_curve.DiffieHellmanRatchet):
        _q = [unhex(ratchet_priv_hex)] if ratchet_priv_hex else []

        @staticmethod
        def _generate_priv():
            return Fixed._q.pop(0) if Fixed._q else \
                dh_curve.DiffieHellmanRatchet._generate_priv()

    return Fixed


def model_from_hexified(m):
    def chain(c):
        return None if c is None else KDFChainModel(
            key=bytes.fromhex(c["key"]), length=c["length"])

    return DoubleRatchetModel(
        diffie_hellman_ratchet=DiffieHellmanRatchetModel(
            own_ratchet_priv=bytes.fromhex(m["ownRatchetPriv"]),
            other_ratchet_pub=bytes.fromhex(m["otherRatchetPub"]),
            root_chain=chain(m["rootChain"]),
            symmetric_key_ratchet=SymmetricKeyRatchetModel(
                sending_chain=chain(m["sendingChain"]),
                receiving_chain=chain(m["receivingChain"]),
                previous_sending_chain_length=m["previousSendingChainLength"],
            ),
        ),
        skipped_message_keys=[
            SkippedMessageKeyModel(
                ratchet_pub=bytes.fromhex(k["ratchetPub"]),
                index=k["index"],
                message_key=bytes.fromhex(k["messageKey"]),
            )
            for k in m["skippedMessageKeys"]
        ],
    )


def model_to_hexified(dr):
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


def build_dr(profile, model, ratchet_priv_hex=None):
    b = BACKENDS[profile]
    return b.DoubleRatchetImpl.from_model(
        model_from_hexified(model),
        make_dhratchet_class(ratchet_priv_hex),
        b.RootChainKDFImpl,
        b.MessageChainKDFImpl,
        b.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
        1000,
        1000,
        b.AEADImpl,
    )


def em_from_wire(w):
    return doubleratchet.EncryptedMessage(
        doubleratchet.Header(unhex(w["ratchetPub"]), w["pn"], w["n"]),
        unhex(w["ciphertext"]),
    )


def wire_from_em(em):
    return {
        "ratchetPub": em.header.ratchet_pub.hex(),
        "pn": em.header.previous_sending_chain_length,
        "n": em.header.sending_chain_length,
        "ciphertext": em.ciphertext.hex(),
    }


def ekm_to_em(profile, authenticated_message, jid, device_id):
    """Turn serialized authenticated message bytes into an EncryptedMessage."""
    ekm = BACKENDS[profile].EncryptedKeyMaterialImpl.parse(
        authenticated_message, jid, device_id)
    return ekm.encrypted_message


def parse_kex(profile, data, sign_bit):
    """Parse a wire OMEMOKeyExchange into (KeyExchangeImpl, auth msg bytes)."""
    if profile == "legacy":
        return old.KeyExchangeImpl.parse(data, bool(sign_bit))
    return two.KeyExchangeImpl.parse(data)


def passive_session(profile, kex, auth_msg, x3dh_params):
    """Run passive X3DH + initial ratchet decrypt for a parsed key exchange.

    Returns (DoubleRatchetImpl, plaintext, shared_secret, associated_data).
    """
    ik_priv = unhex(x3dh_params["ikPriv"])
    spk_priv = unhex(x3dh_params["spkPriv"])
    pk_priv = unhex(x3dh_params["pkPriv"]) if x3dh_params.get("pkPriv") else None

    state = make_state(profile, x3dh_params["ikPriv"], x3dh_params["spkPriv"],
                       [x3dh_params["pkPriv"]] if pk_priv else [])
    header = x3dh.Header(
        identity_key=kex.header.identity_key,
        ephemeral_key=kex.header.ephemeral_key,
        pre_key=curve_pub(pk_priv) if pk_priv else None,
        signed_pre_key=curve_pub(spk_priv),
    )

    async def run_x3dh():
        return await state.get_shared_secret_passive(
            header, require_pre_key=pk_priv is not None)

    sk, ad, _spk = asyncio.run(run_x3dh())

    b = BACKENDS[profile]
    em = ekm_to_em(profile, auth_msg, "peer@example.org", 0)

    async def run_dr():
        return await b.DoubleRatchetImpl.decrypt_initial_message(
            make_dhratchet_class(x3dh_params.get("ratchetPriv")),
            b.RootChainKDFImpl,
            b.MessageChainKDFImpl,
            b.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
            1000,
            1000,
            b.AEADImpl,
            sk,
            spk_priv,
            em,
            ad,
        )

    dr, plaintext = asyncio.run(run_dr())
    return dr, plaintext, sk, ad


# ---------------------------------------------------------------------------
# payload (content) encryption
# ---------------------------------------------------------------------------

def payload_encrypt(profile, plaintext, key_hex=None):
    """Returns (key_material, ContentImpl)."""
    if profile == "omemo2":
        key = unhex(key_hex) if key_hex else secrets.token_bytes(32)
        derived = HKDF(
            algorithm=hashes.SHA256(), length=80, salt=b"\x00" * 32,
            info=b"OMEMO Payload").derive(key)
        enc_key, auth_key, iv = derived[:32], derived[32:64], derived[64:]
        padder = padding.PKCS7(128).padder()
        padded = padder.update(plaintext) + padder.finalize()
        enc = Cipher(algorithms.AES(enc_key), modes.CBC(iv)).encryptor()
        ct = enc.update(padded) + enc.finalize()
        h = chmac.HMAC(auth_key, hashes.SHA256())
        h.update(ct)
        return key + h.finalize()[:16], two.ContentImpl(ct)

    key = unhex(key_hex) if key_hex else secrets.token_bytes(16)
    iv = secrets.token_bytes(12)
    enc = Cipher(algorithms.AES(key), modes.GCM(iv)).encryptor()
    ct = enc.update(plaintext) + enc.finalize()
    return key + enc.tag, old.ContentImpl(ct, iv)


def payload_decrypt(profile, key_material, content):
    """Returns the decrypted payload plaintext bytes."""
    if profile == "omemo2":
        if len(key_material) != 48:
            raise ValueError("omemo2 key material must be 48 bytes")
        key, tag = key_material[:32], key_material[32:]
        derived = HKDF(
            algorithm=hashes.SHA256(), length=80, salt=b"\x00" * 32,
            info=b"OMEMO Payload").derive(key)
        enc_key, auth_key, iv = derived[:32], derived[32:64], derived[64:]
        h = chmac.HMAC(auth_key, hashes.SHA256())
        h.update(content.ciphertext)
        if h.finalize()[:16] != tag:
            raise ValueError("payload authentication failed")
        dec = Cipher(algorithms.AES(enc_key), modes.CBC(iv)).decryptor()
        padded = dec.update(content.ciphertext) + dec.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        return unpadder.update(padded) + unpadder.finalize()

    if len(key_material) != 32:
        raise ValueError("legacy key material must be 32 bytes")
    key, tag = key_material[:16], key_material[16:]
    dec = Cipher(
        algorithms.AES(key),
        modes.GCM(content.initialization_vector, tag)).decryptor()
    return dec.update(content.ciphertext) + dec.finalize()


# ---------------------------------------------------------------------------
# primitive ops
# ---------------------------------------------------------------------------

def op_xeddsa_verify(req):
    valid = xeddsa.ed25519_verify(
        unhex(req["sig"]), unhex(req["edPub"]), unhex(req["msg"]))
    return {"valid": valid}


def op_xeddsa_verify_curve(req):
    # wire signatures carry the sign bit in the top bit of s; strip it before
    # verification, mirroring oldmemo etree.parse_bundle
    ed_pub = xeddsa.curve25519_pub_to_ed25519_pub(
        unhex(req["curvePub"]), bool(req["signBit"]))
    sig = bytearray(unhex(req["sig"]))
    sig[63] &= 0x7f
    valid = xeddsa.ed25519_verify(bytes(sig), ed_pub, unhex(req["msg"]))
    return {"valid": valid, "edPub": ed_pub.hex()}


def op_x25519(req):
    return {"shared": xeddsa.x25519(unhex(req["priv"]), unhex(req["pub"])).hex()}


def op_x3dh_passive(req):
    state_cls, info = STATE_CLASSES[req["profile"]]
    h = req["header"]

    orig_tb = secrets.token_bytes
    queue = [
        unhex(req["spkPriv"]),
        hashlib.sha256(b"nonce").digest() + hashlib.sha256(b"nonce2").digest(),
    ]
    if req.get("pkPriv"):
        queue.append(unhex(req["pkPriv"]))
    try:
        secrets.token_bytes = lambda n: queue.pop(0)
        bob = state_cls.create(
            x3dh.IdentityKeyFormat.ED_25519,
            x3dh.HashFunction.SHA_256,
            info,
            ikp.IdentityKeyPairPriv(unhex(req["ikPriv"])),
        )
        if req.get("pkPriv"):
            bob.generate_pre_keys(1)
    finally:
        secrets.token_bytes = orig_tb

    header = x3dh.Header(
        identity_key=unhex(h["ikEdPub"]),
        ephemeral_key=unhex(h["ek"]),
        pre_key=unhex(h["pkPub"]) if h.get("pkPub") else None,
        signed_pre_key=unhex(h["spkPub"]),
    )

    async def run():
        return await bob.get_shared_secret_passive(
            header, require_pre_key=req.get("pkPriv") is not None)

    sk, ad, _spk = asyncio.run(run())
    return {"sharedSecret": sk.hex(), "associatedData": ad.hex()}


def op_x3dh_active(req):
    """Reference initiator against a bundle parsed from our XML.

    The initiator's own signed pre key is irrelevant for the agreement, so
    spkPriv may be omitted and a throwaway value is used.
    """
    etree_mod = ETREE[req["profile"]]
    bundle = etree_mod.parse_bundle(
        ET.fromstring(req["bundleXml"]), req["bundleJid"], req["bundleDeviceId"])

    spk_priv = unhex(req["spkPriv"]) if req.get("spkPriv") else \
        hashlib.sha256(b"pyverify-throwaway-spk").digest()
    ek_priv = unhex(req["ekPriv"]) if req.get("ekPriv") else \
        secrets.token_bytes(32)

    orig_tb, orig_choice = secrets.token_bytes, secrets.choice
    queue = [spk_priv, det_nonce(spk_priv)]
    try:
        secrets.token_bytes = lambda n: queue.pop(0)
        secrets.choice = lambda seq: seq[0]
        state_cls, info = STATE_CLASSES[req["profile"]]
        alice = state_cls.create(
            x3dh.IdentityKeyFormat.ED_25519,
            x3dh.HashFunction.SHA_256,
            info,
            ikp.IdentityKeyPairPriv(unhex(req["ikPriv"])),
        )
        secrets.token_bytes = lambda n: ek_priv

        async def run():
            return await alice.get_shared_secret_active(
                bundle.bundle, require_pre_key=req.get("requirePreKey", True))

        sk, ad, header = asyncio.run(run())
    finally:
        secrets.token_bytes = orig_tb
        secrets.choice = orig_choice

    return {
        "sharedSecret": sk.hex(),
        "associatedData": ad.hex(),
        "header": {
            "identityKey": header.identity_key.hex(),
            "ephemeralKey": header.ephemeral_key.hex(),
            "signedPreKey": header.signed_pre_key.hex(),
            "preKey": header.pre_key.hex() if header.pre_key else None,
        },
    }


# ---------------------------------------------------------------------------
# ratchet ops
# ---------------------------------------------------------------------------

def op_dr_decrypt(req):
    dr = build_dr(req["profile"], req["model"])
    em = em_from_wire(req["wire"])

    async def run():
        return await dr.decrypt_message(em, unhex(req["ad"]))

    pt = asyncio.run(run())
    return {"plaintext": pt.hex(), "model": model_to_hexified(dr)}


def op_dr_encrypt(req):
    dr = build_dr(req["profile"], req["model"], req.get("ratchetPriv"))

    async def run():
        return await dr.encrypt_message(unhex(req["plaintext"]), unhex(req["ad"]))

    em = asyncio.run(run())
    return {"wire": wire_from_em(em), "model": model_to_hexified(dr)}


def op_dr_init_active(req):
    b = BACKENDS[req["profile"]]

    async def run():
        return await b.DoubleRatchetImpl.encrypt_initial_message(
            make_dhratchet_class(req.get("ratchetPriv")),
            b.RootChainKDFImpl,
            b.MessageChainKDFImpl,
            b.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
            1000,
            1000,
            b.AEADImpl,
            unhex(req["sharedSecret"]),
            unhex(req["recipientRatchetPub"]),
            unhex(req["plaintext"]),
            unhex(req["ad"]),
        )

    dr, em = asyncio.run(run())
    return {"wire": wire_from_em(em), "model": model_to_hexified(dr)}


def op_dr_init_passive(req):
    b = BACKENDS[req["profile"]]

    async def run():
        return await b.DoubleRatchetImpl.decrypt_initial_message(
            make_dhratchet_class(req.get("ratchetPriv")),
            b.RootChainKDFImpl,
            b.MessageChainKDFImpl,
            b.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
            1000,
            1000,
            b.AEADImpl,
            unhex(req["sharedSecret"]),
            unhex(req["ownRatchetPriv"]),
            em_from_wire(req["wire"]),
            unhex(req["ad"]),
        )

    dr, pt = asyncio.run(run())
    return {"plaintext": pt.hex(), "model": model_to_hexified(dr)}


# ---------------------------------------------------------------------------
# key exchange ops
# ---------------------------------------------------------------------------

def op_kex_build(req):
    """Reference initiator: X3DH against our bundle + first ratchet message."""
    b = BACKENDS[req["profile"]]
    x = op_x3dh_active(req)
    header = x3dh.Header(
        identity_key=unhex(x["header"]["identityKey"]),
        ephemeral_key=unhex(x["header"]["ephemeralKey"]),
        pre_key=unhex(x["header"]["preKey"]),
        signed_pre_key=unhex(x["header"]["signedPreKey"]),
    )

    etree_mod = ETREE[req["profile"]]
    bundle = etree_mod.parse_bundle(
        ET.fromstring(req["bundleXml"]), req["bundleJid"], req["bundleDeviceId"])
    spk_id = bundle.signed_pre_key_id
    pk_id = bundle.pre_key_ids[header.pre_key] if header.pre_key else -1

    res = op_dr_init_active({
        "profile": req["profile"],
        "sharedSecret": x["sharedSecret"],
        "recipientRatchetPub": x["header"]["signedPreKey"],
        "plaintext": req["plaintext"],
        "ad": x["associatedData"],
        "ratchetPriv": req.get("ratchetPriv"),
    })
    em_ct = unhex(res["wire"]["ciphertext"])

    kex = b.KeyExchangeImpl(header, spk_id, max(pk_id, 0))
    serialized = kex.serialize(em_ct)
    wire_bytes = serialized[0] if isinstance(serialized, tuple) else serialized

    return {
        "kexData": wire_bytes.hex(),
        "sharedSecret": x["sharedSecret"],
        "associatedData": x["associatedData"],
        "model": res["model"],
        "wire": res["wire"],
        "header": x["header"],
        "spkId": spk_id,
        "pkId": pk_id,
    }


def op_kex_accept(req):
    """Reference responder: parse our key exchange bytes, X3DH + decrypt."""
    kex, auth_msg = parse_kex(
        req["profile"], unhex(req["kexData"]), req.get("ikSignBit", 0))
    dr, pt, sk, ad = passive_session(req["profile"], kex, auth_msg, req)
    return {
        "plaintext": pt.hex(),
        "model": model_to_hexified(dr),
        "sharedSecret": sk.hex(),
        "associatedData": ad.hex(),
        "spkId": kex.signed_pre_key_id,
        "pkId": kex.pre_key_id,
    }


# ---------------------------------------------------------------------------
# full message ops
# ---------------------------------------------------------------------------

def op_msg_encrypt(req):
    """Reference sender: produce a complete <encrypted> element as XML."""
    profile = req["profile"]
    b = BACKENDS[profile]
    etree_mod = ETREE[profile]

    key_material, content = payload_encrypt(
        profile, unhex(req["plaintext"]), req.get("payloadKey"))

    if "x3dh" in req:
        # fresh session: X3DH against the recipient bundle, kex wire key
        x = req["x3dh"]
        built = op_kex_build({
            "profile": profile,
            "ikPriv": x["ikPriv"],
            "bundleXml": x["bundleXml"],
            "bundleJid": x["bundleJid"],
            "bundleDeviceId": x["bundleDeviceId"],
            "ekPriv": x.get("ekPriv"),
            "ratchetPriv": x.get("ratchetPriv"),
            "plaintext": key_material.hex(),
        })
        header = x3dh.Header(
            identity_key=unhex(built["header"]["identityKey"]),
            ephemeral_key=unhex(built["header"]["ephemeralKey"]),
            pre_key=unhex(built["header"]["preKey"]),
            signed_pre_key=unhex(built["header"]["signedPreKey"]),
        )
        kex_obj = b.KeyExchangeImpl(header, built["spkId"], max(built["pkId"], 0))
        em = em_from_wire(built["wire"])
        ekm = b.EncryptedKeyMaterialImpl(req["recipientJid"], req["rid"], em)
        keys = frozenset([(ekm, kex_obj)])
        model = built["model"]
        extra = {
            "sharedSecret": built["sharedSecret"],
            "associatedData": built["associatedData"],
        }
        was_kex = True
    else:
        sess = req["session"]
        dr = build_dr(profile, sess["model"], sess.get("ratchetPriv"))

        async def run():
            return await dr.encrypt_message(key_material, unhex(sess["ad"]))

        em = asyncio.run(run())
        ekm = b.EncryptedKeyMaterialImpl(req["recipientJid"], req["rid"], em)
        keys = frozenset([(ekm, None)])
        model = model_to_hexified(dr)
        extra = {}
        was_kex = False

    msg = OmemoMessageStruct(
        namespace=NAMESPACES[profile],
        bare_jid=req["senderJid"],
        device_id=req["sid"],
        content=content,
        keys=keys,
    )
    ET.register_namespace("", NAMESPACES[profile])
    xml = ET.tostring(etree_mod.serialize_message(msg), encoding="unicode")
    return {"xml": xml, "model": model, "wasKex": was_kex, **extra}


def op_msg_decrypt(req):
    """Reference recipient: parse and decrypt our <encrypted> element."""
    profile = req["profile"]
    b = BACKENDS[profile]
    etree_mod = ETREE[profile]
    ns = NAMESPACES[profile]
    nstag = "{%s}" % ns
    elt = ET.fromstring(req["xml"])

    device_id = req["deviceId"]

    if profile == "omemo2":
        # The reference parser schema-validates the element and returns the
        # parsed key material including any key exchange.
        msg = etree_mod.parse_message(elt, req["senderJid"])
        chosen = None
        for ekm, kex in msg.keys:
            if ekm.device_id == device_id:
                chosen = (ekm, kex)
                break
        if chosen is None:
            raise ValueError("no key material for device %d" % device_id)
        ekm, kex = chosen
        em = ekm.encrypted_message
        content = msg.content
        sid = msg.device_id
    else:
        # oldmemo parse_message needs a SessionManager to look up the sender
        # sign bit, so the bridge does the schema validation plus the parse
        # steps itself; the crypto path is unchanged.
        etree_mod.MESSAGE_SCHEMA.validate(elt)
        header_elt = elt.find(f"{nstag}header")
        sid = int(header_elt.get("sid"))
        iv_elt = header_elt.find(f"{nstag}iv")
        iv = base64.b64decode(iv_elt.text) if iv_elt is not None else None
        payload_elt = elt.find(f"{nstag}payload")
        content = (
            old.ContentImpl.make_empty()
            if payload_elt is None
            else old.ContentImpl(base64.b64decode(payload_elt.text), iv)
        )
        kex = None
        em = None
        for key_elt in header_elt.iter(f"{nstag}key"):
            if int(key_elt.get("rid")) != device_id:
                continue
            data = base64.b64decode(key_elt.text)
            if key_elt.get("prekey", "false") in ("true", "1"):
                kex, auth_msg = parse_kex(
                    profile, data, req.get("x3dh", {}).get("ikSignBit", 0))
            else:
                auth_msg = data
            ekm = b.EncryptedKeyMaterialImpl.parse(
                auth_msg, req["ownJid"], device_id)
            em = ekm.encrypted_message
        if em is None:
            raise ValueError("no key material for device %d" % device_id)

    was_kex = kex is not None
    if req.get("session") is not None:
        # An established session decrypts the wrapped ratchet message no
        # matter whether the element still carries a key exchange, the same
        # way an established session on our side ignores a repeated kex
        # header.
        sess = req["session"]
        dr = build_dr(profile, sess["model"])
        ad = unhex(sess["ad"])

        async def run():
            return await dr.decrypt_message(em, ad)

        key_material = asyncio.run(run())
        extra = {}
    elif was_kex:
        # the EncryptedMessage ciphertext carries the wrapped authenticated
        # message for both profiles
        auth_msg = em.ciphertext
        dr, key_material, sk, ad = passive_session(
            profile, kex, auth_msg, req["x3dh"])
        extra = {"sharedSecret": sk.hex()}
    else:
        raise ValueError("key element requires 'x3dh' or 'session' parameters")

    plaintext = None if content.empty else payload_decrypt(
        profile, key_material, content).hex()

    return {
        "plaintext": plaintext,
        "model": model_to_hexified(dr),
        "ad": ad.hex(),
        "wasKex": was_kex,
        "sid": sid,
        **extra,
    }


# ---------------------------------------------------------------------------
# bundle ops
# ---------------------------------------------------------------------------

def op_bundle_serialize(req):
    """Reference-produced bundle XML from injected key material."""
    profile = req["profile"]
    state = make_state(profile, req["ikPriv"], req["spkPriv"], req["pkPrivs"])
    bundle_cls = old.BundleImpl if profile == "legacy" else two.BundleImpl
    b = bundle_cls(
        bare_jid=req["jid"],
        device_id=req["deviceId"],
        bundle=state.bundle,
        signed_pre_key_id=req["spkId"],
        pre_key_ids={
            curve_pub(unhex(p)): i
            for p, i in zip(req["pkPrivs"], req["pkIds"])
        },
    )
    ET.register_namespace("", NAMESPACES[profile])
    return {
        "xml": ET.tostring(
            ETREE[profile].serialize_bundle(b), encoding="unicode")
    }


def op_bundle_parse(req):
    """Parse our bundle XML with the reference parser."""
    profile = req["profile"]
    b = ETREE[profile].parse_bundle(
        ET.fromstring(req["xml"]), req["jid"], req["deviceId"])
    return {
        "identityKey": b.bundle.identity_key.hex(),
        "signedPreKey": b.bundle.signed_pre_key.hex(),
        "signedPreKeySignature": b.bundle.signed_pre_key_sig.hex(),
        "signedPreKeyId": b.signed_pre_key_id,
        "preKeys": {pub.hex(): i for pub, i in b.pre_key_ids.items()},
    }


OPS = {
    "xeddsa_verify": op_xeddsa_verify,
    "xeddsa_verify_curve": op_xeddsa_verify_curve,
    "x25519": op_x25519,
    "x3dh_passive": op_x3dh_passive,
    "x3dh_active": op_x3dh_active,
    "dr_decrypt": op_dr_decrypt,
    "dr_encrypt": op_dr_encrypt,
    "dr_init_active": op_dr_init_active,
    "dr_init_passive": op_dr_init_passive,
    "kex_build": op_kex_build,
    "kex_accept": op_kex_accept,
    "msg_encrypt": op_msg_encrypt,
    "msg_decrypt": op_msg_decrypt,
    "bundle_serialize": op_bundle_serialize,
    "bundle_parse": op_bundle_parse,
}


def handle(req):
    try:
        res = OPS[req["op"]](req)
        res["ok"] = True
    except Exception as e:  # report, don't crash-loop
        res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return res


def main():
    # The bridge speaks one JSON request per stdin line and answers with one
    # JSON response per stdout line. A single-shot caller can send one line
    # (or one JSON document) and close stdin; a long-running caller keeps the
    # process alive and avoids paying interpreter startup per request.
    decoder = json.JSONDecoder()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req, end = decoder.raw_decode(line)
            res = handle(req)
            if line[end:].strip():
                raise ValueError("trailing data after request")
        except Exception as e:
            res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        print(json.dumps(res), flush=True)


if __name__ == "__main__":
    main()
