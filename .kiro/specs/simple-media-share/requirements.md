# Requirements Document

## Introduction

The Simple Media Share feature enables users of the veeder React Native mobile application to select image or video files from their device and share them to other applications through the operating system's native share sheet. The feature covers requesting the necessary media access permission, browsing and selecting a single media item, previewing the selection, and invoking the platform share dialog. The feature targets both Android and iOS platforms and is designed to give clear feedback for permission denials, unsupported files, and share cancellations.

## Glossary

- **Media_Share_System**: The overall feature-level component within the veeder app responsible for selecting and sharing media items.
- **Media_Picker**: The subcomponent that presents the device media library and returns the user's selected media item.
- **Permission_Manager**: The subcomponent that requests and evaluates operating system permission to access the device media library.
- **Share_Presenter**: The subcomponent that invokes the native operating system share sheet with a selected media item.
- **Media_Item**: A single image or video file selected by the user, identified by a file URI, MIME type, and file size.
- **Supported_Media_Type**: An image with MIME type `image/jpeg`, `image/png`, or `image/gif`, or a video with MIME type `video/mp4` or `video/quicktime`.
- **Share_Sheet**: The native operating system dialog that lists target applications for sharing content.
- **Maximum_File_Size**: A file size limit of 100 megabytes applied to a selected Media_Item.
- **User**: A person operating the veeder mobile application.

## Requirements

### Requirement 1: Request Media Library Permission

**User Story:** As a User, I want the app to request permission to access my media library, so that I can select media to share while retaining control over my device privacy.

#### Acceptance Criteria

1. WHEN the User initiates a media share action AND media library permission has not been previously granted or denied, THE Permission_Manager SHALL request media library permission from the operating system within 1 second of the action.
2. WHEN the User grants media library permission, THE Media_Share_System SHALL open the Media_Picker within 1 second of receiving the grant result.
3. IF the User denies media library permission on a non-permanent basis, THEN THE Media_Share_System SHALL display a message indicating that media access is required to share media, and SHALL NOT open the Media_Picker.
4. WHEN the User initiates a media share action AND media library permission is already granted, THE Permission_Manager SHALL open the Media_Picker within 1 second without issuing a new permission request.
5. IF media library permission is permanently denied, THEN THE Media_Share_System SHALL display a message directing the User to enable media access in the device settings, and SHALL NOT open the Media_Picker.
6. IF the operating system permission request fails to return a result within 10 seconds, THEN THE Permission_Manager SHALL treat the request as not granted and THE Media_Share_System SHALL display a message indicating that media access could not be obtained.

### Requirement 2: Select a Media Item

**User Story:** As a User, I want to browse my device media library and choose a single image or video, so that I can share the specific item I want.

#### Acceptance Criteria

1. WHEN the Media_Picker opens, THE Media_Picker SHALL display every Media_Item in the device media library whose type is a Supported_Media_Type.
2. WHEN the User selects one Media_Item whose type is a Supported_Media_Type and whose size does not exceed Maximum_File_Size, THE Media_Picker SHALL return the selected Media_Item to the Media_Share_System.
3. WHEN the User closes the Media_Picker without selecting a Media_Item, THE Media_Share_System SHALL return to the previous screen without changing the current selection.
4. THE Media_Picker SHALL allow selection of exactly one Media_Item per share action.
5. IF the User selects a Media_Item whose size exceeds Maximum_File_Size, THEN THE Media_Picker SHALL reject the selection, retain the Media_Picker in the open state, and display an error indicating the Media_Item exceeds the allowed size.
6. IF the device media library contains no Media_Item whose type is a Supported_Media_Type, THEN THE Media_Picker SHALL display an empty-state message indicating no shareable items are available.

### Requirement 3: Validate the Selected Media Item

**User Story:** As a User, I want the app to confirm that my selected file is a supported type and size, so that I avoid share failures.

#### Acceptance Criteria

1. WHEN a Media_Item is returned from the Media_Picker, THE Media_Share_System SHALL evaluate, within 2 seconds, whether the Media_Item is a Supported_Media_Type and whether the Media_Item is within the Maximum_File_Size.
2. IF the selected Media_Item is not a Supported_Media_Type, THEN THE Media_Share_System SHALL display a message indicating that the file type is not supported and SHALL NOT mark the Media_Item as ready to share.
3. IF the selected Media_Item is a Supported_Media_Type AND exceeds the Maximum_File_Size, THEN THE Media_Share_System SHALL display a message indicating that the file exceeds the 100 megabyte limit and SHALL NOT mark the Media_Item as ready to share.
4. WHEN the selected Media_Item is a Supported_Media_Type AND is within the Maximum_File_Size, THE Media_Share_System SHALL mark the Media_Item as ready to share.
5. IF the selected Media_Item is both not a Supported_Media_Type AND exceeds the Maximum_File_Size, THEN THE Media_Share_System SHALL display the message indicating that the file type is not supported and SHALL NOT display the file size message.
6. IF no Media_Item is returned from the Media_Picker, THEN THE Media_Share_System SHALL NOT mark any Media_Item as ready to share and SHALL return to its pre-selection state.

### Requirement 4: Preview the Selected Media Item

**User Story:** As a User, I want to see a preview of my selected media before sharing, so that I can confirm I chose the correct item.

#### Acceptance Criteria

1. WHEN a Media_Item is marked as ready to share AND the Media_Item is an image, THE Media_Share_System SHALL display a thumbnail preview of the image within 2 seconds of the Media_Item being marked as ready to share.
2. WHEN a Media_Item is marked as ready to share AND the Media_Item is a video, THE Media_Share_System SHALL display a preview frame captured from the first frame of the video, overlaid with a play indicator control, within 2 seconds of the Media_Item being marked as ready to share.
3. IF a preview for a Media_Item marked as ready to share cannot be generated within 2 seconds or fails to load, THEN THE Media_Share_System SHALL display a placeholder image, display an indication that the preview is unavailable, retain the Media_Item selection, and keep the share control enabled so the User can continue the share action.
4. WHEN a Media_Item is marked as ready to share, THE Media_Share_System SHALL display the file name of the Media_Item, truncating any file name longer than 40 characters with a visible truncation indicator.
5. WHEN a Media_Item is marked as ready to share, THE Media_Share_System SHALL display a control that starts the share action.

### Requirement 5: Share the Media Item

**User Story:** As a User, I want to send my selected media to another app, so that I can share content with people and services I use.

#### Acceptance Criteria

1. WHEN the User starts the share action for a Media_Item whose Supported_Media_Type is valid and whose size does not exceed Maximum_File_Size, THE Share_Presenter SHALL open the Share_Sheet with the Media_Item attached within 3 seconds.
2. WHEN the User selects a target application in the Share_Sheet, THE Share_Presenter SHALL pass the Media_Item to the selected target application within 3 seconds.
3. WHEN the User cancels the Share_Sheet, THE Media_Share_System SHALL return to the preview state with the same Media_Item still selected.
4. IF the Share_Presenter fails to open the Share_Sheet, THEN THE Media_Share_System SHALL display a message indicating that sharing is currently unavailable and SHALL retain the Media_Item in the selected state.
5. IF the User starts the share action for a Media_Item whose Supported_Media_Type is not valid or whose size exceeds Maximum_File_Size, THEN THE Share_Presenter SHALL not open the Share_Sheet and SHALL display a message indicating the reason the Media_Item cannot be shared.
