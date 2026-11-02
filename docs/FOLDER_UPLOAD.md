# Selective MP4 folder uploads

Save the series details in Creator Studio, then choose **Choose a folder** and select the export folder for that series. Windows folder names with spaces, Unicode or punctuation are supported. The browser grants access to the chosen folder; typing a Windows path into the website does not give the server access to that computer.

Folder selection includes `.mp4` and `.MP4` files in the selected folder and its subfolders. It ignores other extensions, including MOV, WebM, images, subtitles, JSON, text and audio sidecars. Hidden/system metadata such as AppleDouble `._` files and `__MACOSX` contents are ignored as well. Ignored files are not sent to the episode-upload endpoint or charged against publisher storage.

All selected videos become episodes of the currently open series. Selecting a parent containing several different series does not create separate series automatically; choose the relevant export subfolder when publishing one series.

Videos are sorted by their relative folder path and filename using numeric order: `1`, `2`, `10`. Different subfolders may contain videos with the same basename; both are retained. The queue displays enough relative path to distinguish them, with the full relative path available on the filename tooltip. Only the original filename and video bytes are sent for episode creation, not the computer's absolute path.

A status message shows how many MP4 videos were found and how many other files were ignored. A folder with no MP4 files sends no episode uploads. Each selected MP4 is still checked for readable video, duration and file size; a filename extension alone does not bypass validation. Existing 240-second, 200 MiB input-file, account storage, ownership, admin and payment-review rules remain enforced. Videos added in later batches start after the latest server episode number.

## Dropping a folder

On browsers supporting directory drag-and-drop, the upload area recursively reads the folder and all directory-reader batches. It captures the browser's directory entries during the drop event and finishes the scan before uploading. The interface shows **Reading folder…** and prevents concurrent selections. An unreadable descendant rejects the scan rather than silently uploading a partial selection. Navigating away cancels the active batch's remaining work.

If directory drop is unavailable, use **Choose a folder**. Manual **Choose video files** and loose-file drops retain the formats supported by the current deployment; the MP4-only rule applies specifically to folder batches. Currently the Cloudflare uploader accepts browser-ready H.264/AAC MP4/MOV files; the standalone Node server can also process supported WebM input.

## Video checks during a batch

The browser checks the file-size limit before sending each episode. It does not require the browser's local video decoder to read every file first. The former twelve-second metadata probe could stop a valid file with “Unable to read video” before any upload request was sent; browser codec support, media errors or probe timeouts did not establish that the server would reject the file.

The server remains authoritative: Cloudflare validates MP4 structure, movie/video/audio durations and H.264/AAC codecs; Node uses FFprobe before conversion. Both reject unreadable media and videos longer than 240 seconds. Size, quota and authorization checks remain enforced. A rejected file shows the server's reason and the remaining batch continues. Browser regressions cover a 34-file batch with a failing local decoder and genuine server rejection of invalid/overlong files.

For a partially successful batch, use **Choose video files** to retry only failed files. New uploads append after the latest episode number; selecting the whole folder again does not replace or deduplicate existing episodes.

## Large uploads on Cloudflare

The Cloudflare adapter streams each file into private R2 multipart storage using exact 5 MiB parts, with only the final part allowed to be smaller. It splits incoming network chunks at that boundary and waits for each storage write before continuing. Part sizes must not depend on the browser's or proxy's stream boundaries: R2 rejects unequal non-final parts, which previously caused HTTP 500 errors for larger valid episodes even though small test videos worked. Unicode filenames do not determine storage keys.

The browser sends large episodes through authenticated chunks so a file up to 200 MiB does not need to fit in one Cloudflare HTTP request. The server assembles the private object and checks its actual size, format and maximum four-minute duration before creating the episode. Uploads remain subject to the account's 5 GiB allowance. No paid Cloudflare plan change is needed for this transport.

The upload tests exercise uneven incoming chunks, boundary sizes and failed/aborted multipart writes. The local Cloudflare integration check uploads and reads a valid MP4 larger than two parts, verifies exact bytes and quota, then checks permanent deletion and restart persistence. The 240-second, 200 MiB and publisher quota limits remain enforced.

The client bounds a batch to 1,000 accepted videos and 20,000 encountered entries. Larger folders receive a clear request to choose a smaller subfolder. All folder hints, summaries and error messages are available in the platform's 21 interface languages.

Implementation: [folder selection and directory traversal](../src/folder-upload.ts), [creator editor](../src/pages/Studio.tsx). These helpers operate on browser File objects and never open a user-supplied filesystem path on the server.
