# Implementation Plan: Simple Media Share

## Overview

This plan implements the Simple Media Share feature as a self-contained module in the existing `veeder` React Native (0.86 / TypeScript) app. The build order follows the design's "pure decision core, thin native shell" principle: shared types and constants first, then the pure decision functions (validation, permission resolution, name truncation) with their property-based tests, then the thin native adapters (permissions, picker, share), then the `MediaShareController` state machine that sequences them, and finally the UI screen and app wiring. Property-based tests use `fast-check` with the already-configured Jest, and each of the 8 design properties maps to its own test sub-task placed next to the code it validates.

## Tasks

- [x] 1. Set up feature module, dependencies, and shared domain types
  - [x] 1.1 Add dependencies and create shared types and constants
    - Add `react-native-permissions`, `react-native-image-picker`, and `react-native-share` to dependencies, and `fast-check` to devDependencies (pin exact versions)
    - Create the `src/mediaShare/` directory structure for the feature module
    - Create `src/mediaShare/types.ts` defining `SupportedMediaType`, `MediaItem`, `PermissionStatus`, `PermissionOutcome`, `ValidationResult`, `PickResult`, `PreviewModel`, `ShareResult`, and `ShareState`
    - Create `src/mediaShare/constants.ts` exporting `SUPPORTED_TYPES` (`image/jpeg`, `image/png`, `image/gif`, `video/mp4`, `video/quicktime`), `MAX_FILE_SIZE_BYTES` (104857600), and `FILE_NAME_MAX_CHARS` (40)
    - _Requirements: 2.1, 3.1_

- [x] 2. Implement the pure MediaValidator
  - [x] 2.1 Implement `validateMediaItem` and `canShare` in `src/mediaShare/MediaValidator.ts`
    - `validateMediaItem` returns `{ ready: true }` only when the MIME type is in `SUPPORTED_TYPES` and `sizeBytes` is within `MAX_FILE_SIZE_BYTES`
    - Check type before size so an unsupported-and-oversize item returns the single reason `unsupported_type`; return `exceeds_size` only when the type is supported but size exceeds the limit
    - Include the user-facing message strings for `unsupported_type` and `exceeds_size`
    - `canShare(item)` returns true iff `validateMediaItem(item).ready` is true
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 5.5_

  - [x]* 2.2 Write property test for media validation classification
    - **Property 3: Media validation classifies type and size with type precedence**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
    - Generators cover supported/unsupported MIME types and sizes at the 100 MB boundary (0, just under, exactly at, just over); assert exactly one reason and type precedence

  - [x]* 2.3 Write property test for the share-eligibility gate
    - **Property 4: The share-eligibility gate agrees with validation**
    - **Validates: Requirements 5.5**
    - Assert `canShare(item) === validateMediaItem(item).ready` for all generated items and that the surfaced reason matches

  - [x]* 2.4 Write edge-case unit tests for validation boundaries
    - Size 0, exactly `MAX_FILE_SIZE_BYTES`, and one byte over, for both an image and a video type
    - Combined unsupported-type-and-oversize input confirming type-message precedence
    - _Requirements: 3.3, 3.5_

- [x] 3. Implement the PermissionManager
  - [x] 3.1 Implement pure `resolvePermissionOutcome` in `src/mediaShare/PermissionManager.ts`
    - Map `granted` → `open_picker`; `denied` → `show_message: access_required`; `blocked` → `show_message: open_settings`; `error` → `show_message: unavailable`
    - Never return `open_picker` for any non-granted status
    - _Requirements: 1.2, 1.3, 1.5, 1.6_

  - [x]* 3.2 Write property test for permission outcome resolution
    - **Property 1: Permission status maps to the correct outcome**
    - **Validates: Requirements 1.2, 1.3, 1.5, 1.6**

  - [x] 3.3 Implement effectful `ensurePermission` wrapping `react-native-permissions`
    - Check current status; issue an OS request only when status is `not_determined`; return existing status otherwise without a new request
    - Enforce a 10-second timeout that resolves to `error`; issue the request promptly (within the 1s budget)
    - _Requirements: 1.1, 1.4, 1.6_

  - [x]* 3.4 Write property test for conditional request issuance
    - **Property 2: A new request is issued only when permission is undetermined**
    - **Validates: Requirements 1.1, 1.4**
    - Mock the native permissions module; assert `request` is called iff status is `not_determined`

- [x] 4. Implement the PreviewBuilder
  - [x] 4.1 Implement pure `truncateFileName` in `src/mediaShare/PreviewBuilder.ts`
    - Return the original text with `truncated: false` when the name is at most 40 characters
    - Otherwise return text whose visible length (including the truncation indicator) does not exceed 40 characters with `truncated: true`
    - _Requirements: 4.4_

  - [x]* 4.2 Write property test for file-name truncation
    - **Property 6: File-name truncation preserves short names and marks long ones**
    - **Validates: Requirements 4.4**
    - Generators include names around the 40-character boundary and multi-byte/emoji/combining characters

  - [x] 4.3 Implement async `build` with 2s budget and placeholder fallback
    - Produce `image` or `video` (first-frame + play indicator) preview models; on timeout/failure return `unavailable` while retaining selection and keeping share enabled
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 5. Implement the MediaPicker adapter
  - [x] 5.1 Implement `open` in `src/mediaShare/MediaPicker.ts` wrapping `react-native-image-picker`
    - Configure `mediaType` for images and videos, `selectionLimit: 1`, filtered to supported types
    - Normalize the native asset into a `MediaItem`; classify results as `selected`, `cancelled`, `empty`, or `rejected_oversize`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x]* 5.2 Write unit tests for picker result classification
    - Mock the native picker to return selected, cancelled, empty, and oversize results and assert correct `PickResult` normalization
    - _Requirements: 2.3, 2.5, 2.6_

- [x] 6. Implement the SharePresenter adapter
  - [x] 6.1 Implement `present` in `src/mediaShare/SharePresenter.ts` wrapping `react-native-share`
    - Attach the item's file URL, open the OS share sheet, and map results to `shared` | `dismissed` | `failed`
    - _Requirements: 5.1, 5.2_

  - [x]* 6.2 Write unit tests for share result mapping
    - Mock the native share module to resolve/reject and assert `shared`, `dismissed`, and `failed` mappings
    - _Requirements: 5.3, 5.4_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the MediaShareController state machine
  - [x] 8.1 Implement the controller in `src/mediaShare/MediaShareController.ts`
    - Own `ShareState` and sequence `Idle → RequestingPermission → (PermissionDenied/PermissionBlocked/PermissionError) → PickerOpen → Validating → Ready → Sharing → Idle`
    - Wire in `PermissionManager`, `MediaPicker`, `MediaValidator`, `PreviewBuilder`, and `SharePresenter` behind their interfaces
    - On oversize pick, remain in `PickerOpen` and surface the over-size error; on cancel, return to prior state with selection unchanged; on share dismiss/fail, return to `Ready` with the item retained
    - _Requirements: 1.2, 2.2, 2.3, 2.5, 3.6, 4.5, 5.3, 5.4_

  - [x]* 8.2 Write property test for oversize rejection retaining picker state
    - **Property 5: Oversize selection is rejected while the picker state is retained**
    - **Validates: Requirements 2.5**
    - Use mocked adapters and a state-machine model

  - [x]* 8.3 Write property test for the readiness transition
    - **Property 7: Readiness transition matches validation result**
    - **Validates: Requirements 2.2, 3.6, 4.5**
    - Assert the controller marks ready iff an item was returned and validation reports ready; otherwise returns to Idle

  - [x]* 8.4 Write property test for cancellation and post-share state preservation
    - **Property 8: Cancellation and post-share return preserve selection state**
    - **Validates: Requirements 2.3, 5.3, 5.4**
    - Assert picker cancel preserves current selection and share cancel/fail returns to preview with the same item

- [x] 9. Implement the MediaShareScreen UI
  - [x] 9.1 Build `src/mediaShare/MediaShareScreen.tsx` bound to controller state
    - Render the share trigger, preview area (image thumbnail, video frame + play indicator, unavailable placeholder), truncated file-name label, share control, and inline message/error banners for each permission/validation/share outcome
    - _Requirements: 1.3, 1.5, 1.6, 2.6, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 5.4, 5.5_

  - [x]* 9.2 Write example and snapshot tests for the screen
    - Snapshot the preview area in image, video, and unavailable-placeholder states and the truncated file-name label; assert each error-banner message string renders for its state
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 10. Wire the feature into the app and configure native permissions
  - [x] 10.1 Mount `MediaShareScreen` from `App.tsx` as the media-share entry point
    - Instantiate the controller with the concrete adapters and connect it to the screen
    - _Requirements: 1.1_

  - [x] 10.2 Add native permission declarations and verify module linking
    - Add the media/photo permission strings to `android/app/src/main/AndroidManifest.xml` and `ios/veeder/Info.plist`
    - Confirm the three native modules autolink and the app builds on Android and iOS
    - _Requirements: 1.1, 5.1_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements clauses for traceability.
- Property-based tests use `fast-check` + Jest, run a minimum of 100 generated cases each, and carry the comment `// Feature: simple-media-share, Property {number}: {property_text}`.
- Native adapters (`PermissionManager`, `MediaPicker`, `SharePresenter`) are mocked in property/unit tests so runs stay device-free.
- Integration and smoke tests against real native modules and device permission strings are executed manually on device/simulator and are therefore out of scope for the coding tasks above.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3", "4.2", "4.3", "5.2", "6.2"] },
    { "id": 3, "tasks": ["3.4", "8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "8.4", "9.1"] },
    { "id": 5, "tasks": ["9.2", "10.1"] },
    { "id": 6, "tasks": ["10.2"] }
  ]
}
```
