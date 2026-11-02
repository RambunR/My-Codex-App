# Cloudflare media regression fixture

`long-audio-movie-duration.mp4` is synthetic test media: a one-second black H.264 video track and 241 seconds of silent AAC audio. Its MP4 movie-duration field is one second, while the audio-track duration remains 241 seconds. It contains no publisher or user media. Chromium reports a 241-second duration.

It was generated locally using FFmpeg (a black 64×64 source, silent 8kHz mono audio, H.264/AAC, 241-second output), with only the movie-duration field adjusted to represent inconsistent container metadata. This fixture verifies that the server enforces its episode limit using every accepted media track, rather than trusting only movie/video durations. It does not establish that header inspection fully authenticates arbitrary MP4 sample timelines.

`long-video.mp4` is a separate synthetic black H.264 video with its ordinary 241-second movie and video-track durations intact. It verifies the four-minute episode limit remains enforced.

`boundary-video-audio-180.mp4` is an ordinary 180-second black H.264/silent AAC export from FFmpeg. The AAC media-duration header includes 1024 priming samples; its normal-speed edit list trims those samples, and ffprobe reports a 180-second presentation. It verifies that enforcing all track durations does not reject a legitimate three-minute episode due to encoder priming.

`boundary-video-audio-240.mp4` is an ordinary 240-second black H.264/silent AAC export generated with the same settings. It exercises exact acceptance at the new four-minute boundary, including AAC encoder priming, while retaining the older three-minute compatibility fixture.
