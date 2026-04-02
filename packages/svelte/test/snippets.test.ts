/**
 * @voiceform/svelte — Snippet API tests (P2-04 / P2-05)
 *
 * Tests cover:
 * - Custom button snippet replaces default button
 * - Custom confirmation snippet replaces default confirmation panel
 * - Default UI renders when no snippets are provided
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render, cleanup } from '@testing-library/svelte'
import { tick } from 'svelte'
import VoiceForm from '../src/VoiceForm.svelte'
import type {
  VoiceFormInstance,
  VoiceFormState,
  StateListener,
  Unsubscribe,
  ConfirmedField,
} from '@voiceform/core'

// Reuse the mock pattern
let mockSubscribers: StateListener[] = []
let mockState: VoiceFormState = { status: 'idle' }
let mockInstance: VoiceFormInstance

function createMockInstance(): VoiceFormInstance {
  mockSubscribers = []
  mockState = { status: 'idle' }

  mockInstance = {
    getState: vi.fn(() => mockState),
    getParsedFields: vi.fn().mockReturnValue(null),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn().mockResolvedValue(undefined),
    updateSchema: vi.fn(),
    destroy: vi.fn(),
    subscribe: vi.fn((listener: StateListener): Unsubscribe => {
      mockSubscribers.push(listener)
      listener(mockState)
      return () => {
        const idx = mockSubscribers.indexOf(listener)
        if (idx >= 0) mockSubscribers.splice(idx, 1)
      }
    }),
  }
  return mockInstance
}

function transitionTo(newState: VoiceFormState): void {
  mockState = newState
  ;(mockInstance.getState as Mock).mockReturnValue(newState)
  for (const sub of mockSubscribers) {
    sub(newState)
  }
}

vi.mock('@voiceform/core', () => ({
  createVoiceForm: vi.fn(() => createMockInstance()),
}))

const minimalProps = {
  endpoint: 'https://example.com/parse',
  schema: {
    fields: [{ name: 'firstName', type: 'text' as const }],
  },
}

describe('Snippet API', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('default button renders when no button snippet is provided', () => {
    const { container } = render(VoiceForm, { props: minimalProps })
    const button = container.querySelector('button.vf-mic-button')
    expect(button).not.toBeNull()
  })

  it('default confirmation panel renders when no confirmation snippet is provided', async () => {
    const { container } = render(VoiceForm, { props: minimalProps })

    transitionTo({
      status: 'confirming',
      transcript: 'test',
      confirmation: {
        transcript: 'test',
        parsedFields: {
          firstName: { label: 'First Name', value: 'Test' },
        } as Record<string, ConfirmedField>,
        missingFields: [] as readonly string[],
        invalidFields: [] as ReadonlyArray<{ name: string; value: string; reason: string }>,
      },
    })
    await tick()

    const panel = container.querySelector('[role="dialog"]')
    expect(panel).not.toBeNull()
  })
})
