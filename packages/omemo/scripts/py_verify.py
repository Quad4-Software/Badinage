#!/usr/bin/env python3
"""One-shot verification bridge for the TypeScript OMEMO interop tests.

Reads a JSON request on stdin, performs an operation with the python-omemo
reference stack, writes a JSON result on stdout. All byte strings are hex.

Request: {"op": <name>, ...operation specific hex fields}

Operations:
  xeddsa_verify      {edPub, msg, sig} -> {valid}
  xeddsa_verify_curve {curvePub, signBit, msg, sig} -> {valid, edPub}
  x25519             {priv, pub} -> {shared}
  x3dh_passive       {profile, ikPriv, spkPriv, pkPriv?, header:{ikEdPub, ek,
                     spkPub, pkPub?}} -> {sharedSecret, associatedData}
  dr_decrypt         {profile, model, wire:{ratchetPub,pn,n,ciphertext}, ad}
                     -> {plaintext, model}
  dr_encrypt         {profile, model, plaintext, ad, ratchetPriv?}
                     -> {wire, model}
"""

import asyncio
import hashlib
import json
import secrets
import sys

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
import twomemo.twomemo as two

BACKENDS = {"legacy": old, "omemo2": two}
STATES = {}


class LegacyState(x3dh.BaseState):
    _encode_public_key = staticmethod(old.StateImpl._encode_public_key)


class Omemo2State(x3dh.BaseState):
    _encode_public_key = staticmethod(two.StateImpl._encode_public_key)


STATE_CLASSES = {"legacy": (LegacyState, old.StateImpl.INFO),
                 "omemo2": (Omemo2State, two.StateImpl.INFO)}


def unhex(s):
    return bytes.fromhex(s) if s is not None else None


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


def build_dr(profile, model):
    b = BACKENDS[profile]
    return b.DoubleRatchetImpl.from_model(
        model,
        dh_curve.DiffieHellmanRatchet,
        b.RootChainKDFImpl,
        b.MessageChainKDFImpl,
        b.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
        1000,
        1000,
        b.AEADImpl,
    )


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


def op_dr_decrypt(req):
    dr = build_dr(req["profile"], model_from_hexified(req["model"]))
    w = req["wire"]
    em = doubleratchet.EncryptedMessage(
        doubleratchet.Header(
            unhex(w["ratchetPub"]),
            w["pn"],
            w["n"],
        ),
        unhex(w["ciphertext"]),
    )

    async def run():
        return await dr.decrypt_message(em, unhex(req["ad"]))

    pt = asyncio.run(run())
    return {"plaintext": pt.hex(), "model": model_to_hexified(dr)}


def op_dr_encrypt(req):
    b = BACKENDS[req["profile"]]

    class Fixed(dh_curve.DiffieHellmanRatchet):
        _q = [unhex(req["ratchetPriv"])] if req.get("ratchetPriv") else []

        @staticmethod
        def _generate_priv():
            return Fixed._q.pop(0) if Fixed._q else \
                dh_curve.DiffieHellmanRatchet._generate_priv()

    dr = b.DoubleRatchetImpl.from_model(
        model_from_hexified(req["model"]),
        Fixed,
        b.RootChainKDFImpl,
        b.MessageChainKDFImpl,
        b.DoubleRatchetImpl.MESSAGE_CHAIN_CONSTANT,
        1000,
        1000,
        b.AEADImpl,
    )

    async def run():
        return await dr.encrypt_message(unhex(req["plaintext"]), unhex(req["ad"]))

    em = asyncio.run(run())
    return {
        "wire": {
            "ratchetPub": em.header.ratchet_pub.hex(),
            "pn": em.header.previous_sending_chain_length,
            "n": em.header.sending_chain_length,
            "ciphertext": em.ciphertext.hex(),
        },
        "model": model_to_hexified(dr),
    }


OPS = {
    "xeddsa_verify": op_xeddsa_verify,
    "xeddsa_verify_curve": op_xeddsa_verify_curve,
    "x25519": op_x25519,
    "x3dh_passive": op_x3dh_passive,
    "dr_decrypt": op_dr_decrypt,
    "dr_encrypt": op_dr_encrypt,
}


def main():
    req = json.load(sys.stdin)
    try:
        res = OPS[req["op"]](req)
        res["ok"] = True
    except Exception as e:  # report, don't crash-loop
        res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    json.dump(res, sys.stdout)


if __name__ == "__main__":
    main()
