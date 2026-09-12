import { AlertDialog as AlertDialogPrimitive } from 'bits-ui'

import Content from './alert-dialog-content.svelte'
import Description from './alert-dialog-description.svelte'
import Root from './alert-dialog.svelte'
import Title from './alert-dialog-title.svelte'
import Footer from '../dialog/dialog-footer.svelte'
import Header from '../dialog/dialog-header.svelte'

const Action = AlertDialogPrimitive.Action
const Cancel = AlertDialogPrimitive.Cancel

export {
  Root as AlertDialog,
  Content as AlertDialogContent,
  Action as AlertDialogAction,
  Cancel as AlertDialogCancel,
  Header as AlertDialogHeader,
  Title as AlertDialogTitle,
  Description as AlertDialogDescription,
  Footer as AlertDialogFooter
}
export default Root
