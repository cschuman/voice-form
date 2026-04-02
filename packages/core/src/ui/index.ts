// @voiceform/core/ui — default UI subpath entry point
//
// Import from '@voiceform/core/ui' to get the default UI components.
// These are kept in a separate subpath so consumers using headless mode
// pay zero bundle cost for UI code.
//
// Full implementations delivered in: P1-09, P1-10, P1-NEW-05.

export { mountDefaultUI } from './default-ui.js'
export { mountConfirmationPanel } from './confirmation-panel.js'
export { mountPrivacyNotice } from './privacy-notice.js'
