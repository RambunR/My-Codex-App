# Selective MP4 folder uploads

Save the series details in Creator Studio, then choose **Choose a folder** and select the export folder for that series. Windows folder names with spaces, Unicode or punctuation are supported. The browser grants access to the chosen folder; typing a Windows path into the website does not give the server access to that computer.

Folder selection includes `.mp4` and `.MP4` files in the selected folder and its subfolders. It ignores other extensions, including MOV, WebM, images, subtitles, JSON, text and audio sidecars. Hidden/system metadata such as AppleDouble `._` files and `__MACOSX` contents are ignored as well. Ignored files are not sent to the episode-upload endpoint or charged against publisher storage.

All selected videos become episodes of the currently open series. Selecting a parent containing several different series does not create separate series automatically; choose the relevant export subfolder when publishing one series.

Videos are sorted by their relative folder path and filename using numeric order: `1`, `2`, `10`. Different subfolders may contain videos with the same basename; both are retained. The queue displays enough relative path to distinguish them, with the full relative path available on the filename tooltip. Only the original filename and video bytes are sent for episode creation, not the computer's absolute path.

A status message shows how many MP4 videos were found and how many other files were ignored. A folder with no MP4 files sends no episode uploads. Each selected MP4 is still checked for readable video, duration and file size; a filename extension alone does not bypass validation. Existing 180-second, 75 MiB input-file, account storage, ownership, admin and payment-review rules remain enforced. Videos added in later batches start after the latest server episode number.

## Dropping a folder

On browsers supporting directory drag-and-drop, the upload area recursively reads the folder and all directory-reader batches. It captures the browser's directory entries during the drop event and finishes the scan before uploading. The interface shows **Reading folder…** and prevents concurrent selections. An unreadable descendant rejects the scan rather than silently uploading a partial selection. Navigating away cancels the active batch's remaining work.

If directory drop is unavailable, use **Choose a folder**. Manual **Choose video files** and loose-file drops retain the formats supported by the current deployment; the MP4-only rule applies specifically to folder batches. Currently the Cloudflare uploader accepts browser-ready H.264/AAC MP4/MOV files; the standalone Node server can also process supported WebM input.

The client bounds a batch to 1,000 accepted videos and 20,000 encountered entries. Larger folders receive a clear request to choose a smaller subfolder. All folder hints, summaries and error messages are available in the platform's 21 interface languages.

Implementation: [folder selection and directory traversal](../src/folder-upload.ts), [creator editor](../src/pages/Studio.tsx). These helpers operate on browser File objects and never open a user-supplied filesystem path on the server.
