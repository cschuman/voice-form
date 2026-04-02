/**
 * @voiceform/svelte — Store integration tests (P2-03 / P2-05)
 *
 * Tests cover:
 * - createVoiceFormStore returns a readable store
 * - Store reflects initial state
 * - Store updates reactively on state transitions
 * - Store unsubscribes properly (no memory leaks)
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createVoiceFormStore } from '../src/stores.js'
import type {
  VoiceFormInstance,
  VoiceFormState,
  StateListener,
  Unsubscribe,
} from '@voiceform/core'

function createMockInstance(
  initialState: VoiceFormState = { status: 'idle' },
): {
  instance: VoiceFormInstance
  emit: (state: VoiceFormState) => void
  getSubscriberCount: () => number
} {
  const subscribers: StateListener[] = []
  let currentState = initialState

  const instance: VoiceFormInstance = {
    getState: vi.fn(() => currentState),
    getParsedFields: vi.fn().mockReturnValue(null),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn().mockResolvedValue(undefined),
    updateSchema: vi.fn(),
    destroy: vi.fn(),
    subscribe: vi.fn((listener: StateListener): Unsubscribe => {
      subscribers.push(listener)
      listener(currentState)
      return () => {
        const idx = subscribers.indexOf(listener)
        if (idx >= 0) subscribers.splice(idx, 1)
      }
    }),
  }

  return {
    instance,
    emit(state: VoiceFormState) {
      currentState = state
      ;(instance.getState as Mock).mockReturnValue(state)
      for (const sub of [...subscribers]) {
        sub(state)
      }
    },
    getSubscriberCount: () => subscribers.length,
  }
}

describe('createVoiceFormStore', () => {
  it('returns a store with a subscribe method', () => {
    const { instance } = createMockInstance()
    const store = createVoiceFormStore(instance)
    expect(typeof store.subscribe).toBe('function')
  })

  it('store reflects initial idle state', () => {
    const { instance } = createMockInstance()
    const store = createVoiceFormStore(instance)
    let value: VoiceFormState | undefined
    const unsub = store.subscribe((v) => {
      value = v
    })
    expect(value?.status).toBe('idle')
    unsub()
  })

  it('store updates when instance state transitions', () => {
    const { instance, emit } = createMockInstance()
    const store = createVoiceFormStore(instance)
    const values: VoiceFormState[] = []
    const unsub = store.subscribe((v) => {
      values.push(v)
    })

    emit({ status: 'recording', interimTranscript: '' })
    emit({ status: 'processing', transcript: 'hello' })

    expect(values.length).toBe(3) // initial idle + recording + processing
    expect(values[0]!.status).toBe('idle')
    expect(values[1]!.status).toBe('recording')
    expect(values[2]!.status).toBe('processing')

    unsub()
  })

  it('unsubscribe prevents further updates', () => {
    const { instance, emit } = createMockInstance()
    const store = createVoiceFormStore(instance)
    const values: VoiceFormState[] = []
    const unsub = store.subscribe((v) => {
      values.push(v)
    })

    emit({ status: 'recording', interimTranscript: '' })
    unsub()
    emit({ status: 'processing', transcript: 'hello' })

    // Should only have idle + recording, not processing
    expect(values.length).toBe(2)
  })

  it('unsubscribes from instance when last subscriber leaves', () => {
    const { instance, getSubscriberCount } = createMockInstance()
    const store = createVoiceFormStore(instance)

    const unsub1 = store.subscribe(() => {})
    const unsub2 = store.subscribe(() => {})

    // Both subscribed: instance should have 1 subscriber (the store itself)
    expect(getSubscriberCount()).toBe(1)

    unsub1()
    // Still one store subscriber, so instance subscription remains
    expect(getSubscriberCount()).toBe(1)

    unsub2()
    // No more store subscribers, instance subscription should be cleaned up
    expect(getSubscriberCount()).toBe(0)
  })

  it('emits each state in correct order during a full flow', () => {
    const { instance, emit } = createMockInstance()
    const store = createVoiceFormStore(instance)
    const statuses: string[] = []
    const unsub = store.subscribe((v) => {
      statuses.push(v.status)
    })

    emit({ status: 'recording', interimTranscript: '' })
    emit({ status: 'processing', transcript: 'John Smith' })
    emit({
      status: 'confirming',
      transcript: 'John Smith',
      confirmation: {
        transcript: 'John Smith',
        parsedFields: { firstName: { label: 'First Name', value: 'John Smith' } },
        missingFields: [],
        invalidFields: [],
      },
    })
    emit({
      status: 'done',
      result: { success: true, fields: { firstName: { status: 'injected', value: 'John Smith' } } },
    })

    expect(statuses).toEqual(['idle', 'recording', 'processing', 'confirming', 'done'])
    unsub()
  })
})
