/**
 * useVoiceForm — React hook for @voiceform/core
 *
 * Wraps a VoiceFormInstance in React's useSyncExternalStore for
 * concurrent-safe state subscriptions.
 *
 * ## Instance lifecycle
 * The instance is created synchronously in a ref guard on the first render.
 * This ensures getSnapshot has a valid instance before useSyncExternalStore
 * is called. The ref guard (`if (instanceRef.current === null)`) is safe in
 * React StrictMode: StrictMode double-invokes the component body and effects
 * in development, but the ref object itself persists across the double-invoke,
 * so the guard fires exactly once per "true" mount.
 *
 * ## StrictMode behavior
 * In React StrictMode (development only):
 * 1. First mount → useEffect cleanup fires → destroy() called, ref set to null
 * 2. Second mount → ref guard fires again → new instance created
 * createVoiceForm is called twice in development. This is expected and correct.
 * The second instance persists for the component's actual lifetime.
 *
 * ## subscribe / getSnapshot stability
 * Both callbacks are wrapped in useCallback with empty deps ([]) so they are
 * stable references across renders. This is critical: useSyncExternalStore
 * uses referential equality to decide whether to re-subscribe. Unstable
 * references cause listener accumulation and unnecessary re-renders.
 */

import { useSyncExternalStore, useCallback, useEffect, useRef } from 'react'
import { createVoiceForm } from '@voiceform/core'
import type { VoiceFormConfig, VoiceFormInstance, VoiceFormState } from '@voiceform/core'

/**
 * The return type of useVoiceForm.
 */
export interface UseVoiceFormResult {
  /** Current state of the voice form engine. Safe to render directly. */
  state: VoiceFormState
  /** The VoiceFormInstance. Stable reference across renders. */
  instance: VoiceFormInstance
}

/**
 * React hook that creates and manages a VoiceFormInstance.
 *
 * @param config - VoiceFormConfig passed to createVoiceForm. The config
 *   reference can change across renders; the hook reads it via a ref so
 *   subscribe/getSnapshot closures remain stable without stale-closure bugs.
 *
 * @returns `{ instance, state }` where `instance` is stable across renders
 *   and `state` is a concurrent-safe snapshot that triggers re-renders on
 *   every state machine transition.
 *
 * @example
 * ```tsx
 * function MyForm() {
 *   const { instance, state } = useVoiceForm({
 *     endpoint: '/api/parse',
 *     schema: mySchema,
 *   })
 *
 *   return (
 *     <button onClick={() => instance.start()}>
 *       {state.status === 'recording' ? 'Stop' : 'Start'}
 *     </button>
 *   )
 * }
 * ```
 */
export function useVoiceForm(config: VoiceFormConfig): UseVoiceFormResult {
  // Instance ref: createVoiceForm is called once on mount only.
  // The null check guard means it runs at most once even in Strict Mode's
  // double-render (which re-uses the same ref object).
  const instanceRef = useRef<VoiceFormInstance | null>(null)

  // Options ref: keeps subscribe/getSnapshot closures up to date without
  // triggering re-subscription on every render.
  const configRef = useRef(config)
  configRef.current = config

  // Synchronous initialization: the instance must exist before the first
  // useSyncExternalStore call so getSnapshot has something to call.
  // This is safe because createVoiceForm() has no side effects observable
  // outside this component's tree.
  if (instanceRef.current === null) {
    instanceRef.current = createVoiceForm(config)
  }

  // CRITICAL: subscribe and getSnapshot MUST be stable references via
  // useCallback with empty deps. Unstable references cause useSyncExternalStore
  // to re-subscribe on every render, which triggers listener accumulation
  // and unnecessary re-renders.
  const subscribe = useCallback((onStoreChange: () => void): (() => void) => {
    // instanceRef.current is normally guaranteed non-null here: it was
    // initialized synchronously above, before hooks run. The one exception is
    // the React StrictMode simulated unmount/remount cycle (development only):
    // useEffect cleanup fires first (setting the ref to null), then React
    // re-invokes subscribe *before* the component body re-runs to re-initialize
    // the ref. In that transient window, we return a no-op unsubscribe. React
    // will call subscribe again once the component re-renders and the ref guard
    // creates a fresh instance.
    if (instanceRef.current === null) {
      return () => { /* no-op — transient StrictMode gap */ }
    }
    const instance = instanceRef.current
    return instance.subscribe(() => onStoreChange())
  }, []) // empty deps — instance identity is stable for the component lifetime

  const getSnapshot = useCallback((): VoiceFormState => {
    return instanceRef.current!.getState()
  }, []) // empty deps — same reasoning as subscribe

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Destroy the instance on unmount.
  // In React StrictMode (development), this useEffect's cleanup fires after
  // the first simulated unmount, calling destroy() and setting the ref to null.
  // The subsequent re-mount runs the synchronous initialization above again,
  // creating a second instance. This is expected and correct — the second
  // instance persists for the component's actual lifetime.
  useEffect(() => {
    return () => {
      instanceRef.current?.destroy()
      instanceRef.current = null
    }
  }, []) // empty deps — only on unmount

  return {
    state,
    instance: instanceRef.current,
  }
}
