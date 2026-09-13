import type { Module, ModuleContext } from '$lib/core/module'

// OMEMO (XEP-0384) support boundary.
//
// libomemo.js is GPL-3.0 and cannot be used in this 0BSD app, so the protocol
// is implemented in-repo as the permissively licensed @quad4-software/omemo
// package (packages/omemo). Everything app code needs is re-exported through
// this boundary so the rest of core only ever depends on this module.

export * from '@quad4-software/omemo'
export { OmemoService } from './service'
export type { DeviceFingerprint } from './service'
export type { TrustLevel } from './trust'

export const omemoModule: Module = {
  id: 'omemo',
  async init(ctx: ModuleContext) {
    await ctx.account.initOmemo()
  }
}
