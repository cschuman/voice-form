import { mount } from 'svelte'
import App from './App.svelte'
import { setupMockServer } from './mockServer'

// Initialize the mock server for the demo
setupMockServer()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
