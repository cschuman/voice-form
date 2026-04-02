/**
 * @voiceform/svelte — Svelte store integration (P2-03)
 *
 * Creates a Svelte-compatible readable store from a VoiceFormInstance.
 * The store subscribes to the instance's state machine and emits each
 * state transition to all Svelte subscribers.
 *
 * Compatible with Svelte 5's `$` auto-subscription syntax.
 */

import type { VoiceFormInstance, VoiceFormState } from '@voiceform/core'

/**
 * A minimal Svelte-compatible readable store interface.
 * Matches the contract required by Svelte's `$store` auto-subscription.
 */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void
}

/**
 * Creates a Svelte readable store that stays in sync with a VoiceFormInstance.
 *
 * The store lazily subscribes to the instance when the first Svelte subscriber
 * joins, and unsubscribes from the instance when the last subscriber leaves.
 * This prevents memory leaks on component unmount.
 *
 * @param instance - The VoiceFormInstance to track.
 * @returns A Svelte-compatible readable store of VoiceFormState.
 *
 * @example
 * ```svelte
 * <script>
 *   import { createVoiceFormStore } from '@voiceform/svelte'
 *   const state = createVoiceFormStore(instance)
 *   // $state.status === 'recording' works reactively
 * </script>
 * ```
 */
export function createVoiceFormStore(
  instance: VoiceFormInstance,
): Readable<VoiceFormState> {
  const subscribers = new Set<(value: VoiceFormState) => void>()
  let instanceUnsub: (() => void) | null = null
  let currentValue: VoiceFormState = instance.getState()

  function startListening(): void {
    if (instanceUnsub) return
    instanceUnsub = instance.subscribe((state: VoiceFormState) => {
      currentValue = state
      for (const sub of subscribers) {
        sub(state)
      }
    })
  }

  function stopListening(): void {
    if (instanceUnsub) {
      instanceUnsub()
      instanceUnsub = null
    }
  }

  return {
    subscribe(run: (value: VoiceFormState) => void): () => void {
      subscribers.add(run)

      // Start listening to instance on first subscriber
      if (subscribers.size === 1) {
        startListening()
      } else {
        // Immediately emit current value for late subscribers
        run(currentValue)
      }

      return () => {
        subscribers.delete(run)
        if (subscribers.size === 0) {
          stopListening()
        }
      }
    },
  }
}
