// Real in-memory OMEMO managers stand in for contacts so fingerprints,
// bundles and the trust flow are exercised end to end in demo mode.

import {
  InMemoryOmemoStore,
  NS_OMEMO2_BUNDLES,
  NS_OMEMO2_DEVICES,
  OmemoManager,
  serializeXml
} from '$lib/core/omemo'

export class DemoOmemoPeers {
  private managers = new Map<string, Promise<OmemoManager>>()

  private managerFor(jid: string): Promise<OmemoManager> {
    let pending = this.managers.get(jid)
    if (!pending) {
      pending = OmemoManager.create({
        namespace: 'omemo2',
        store: new InMemoryOmemoStore(),
        ownJid: jid
      })
      this.managers.set(jid, pending)
    }
    return pending
  }

  private static itemsElement(node: string, payloadXml: string): Element | null {
    const doc = new DOMParser().parseFromString(
      `<items node="${node}"><item id="current">${payloadXml}</item></items>`,
      'text/xml'
    )
    return doc.documentElement
  }

  // only contacts publish fake devices. Our own list stays honest so
  // publishOwn does not pick up a phantom self device
  get(
    node: string,
    jid: string | undefined,
    ownJid: string,
    onDone: (items: Element | null) => void
  ): void {
    const peer = jid ?? ''
    if (!peer || peer === ownJid.split('/')[0]) {
      onDone(null)
      return
    }
    void this.managerFor(peer).then(async (manager) => {
      if (node === NS_OMEMO2_DEVICES) {
        onDone(
          DemoOmemoPeers.itemsElement(
            node,
            `<devices xmlns="${NS_OMEMO2_DEVICES}"><device id="${manager.deviceId}"/></devices>`
          )
        )
        return
      }
      if (node.startsWith(NS_OMEMO2_BUNDLES)) {
        const bundle = serializeXml(await manager.buildBundle())
        onDone(DemoOmemoPeers.itemsElement(node, bundle))
        return
      }
      onDone(null)
    })
  }
}
