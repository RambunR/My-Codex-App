# Cloudflare media regression fixture

`long-audio-movie-duration.mp4` is synthetic test media: a one-second black H.264 video track and 181 seconds of silent AAC audio. Its MP4 movie-duration field is one second, while the audio-track duration remains 181 seconds. It contains no publisher or user media. It is 13,459 bytes and Chromium reports a 181-second duration.

It was generated locally using FFmpeg (a black 64×64 source, silent 8kHz mono audio, H.264/AAC, 181-second output), with only the movie-duration field adjusted to represent inconsistent container metadata. This fixture verifies that the server enforces its episode limit using every accepted media track, rather than trusting only movie/video durations. It does not establish that header inspection fully authenticates arbitrary MP4 sample timelines.

`long-video.mp4` is a separate synthetic black H.264 video with its ordinary 181-second movie and video-track durations intact. It verifies the original long-video rejection remains enforced.

`boundary-video-audio-180.mp4` is an ordinary 180-second black H.264/silent AAC export from FFmpeg. The AAC media-duration header includes 1024 priming samples; its normal-speed edit list trims those samples, and ffprobe reports a 180-second presentation. It verifies that enforcing all track durations does not reject a legitimate three-minute episode due to encoder priming.
