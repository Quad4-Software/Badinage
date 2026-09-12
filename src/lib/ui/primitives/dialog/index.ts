import { Dialog as DialogPrimitive } from 'bits-ui'

import Content from './dialog-content.svelte'
import Description from './dialog-description.svelte'
import Footer from './dialog-footer.svelte'
import Header from './dialog-header.svelte'
import Root from './dialog.svelte'
import Title from './dialog-title.svelte'

const Close = DialogPrimitive.Close

export {
  Root as Dialog,
  Content as DialogContent,
  Description as DialogDescription,
  Footer as DialogFooter,
  Header as DialogHeader,
  Title as DialogTitle,
  Close as DialogClose
}
export default Root
