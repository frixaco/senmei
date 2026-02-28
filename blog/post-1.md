# Senmei - MKV player and upscaler in browser

Very important thing I noticed is what minimal PoC I can make to confirm that my idea works:

- I can upscale anime screenshots using high-end Anime4K profile

A few options I had:

- First set up MKV player and make it ready for providing frames
- Write image upscaler

Obviously, I went with an image upscaler - I pick an image and run the upscaler shaders.
For starters, I went with one only (CNN x2 M one).

---

After successfully porting the a single shader manually (no AI) I started looking at others:
- there 3 shaders that very small - relatively simple and quick
- remaining 2 are much larger - requires much more effort and correctness check

Once 3 simple shaders were done porting, I started focusing on preparing multi-shader pipeline so that I can run multiple shaders (sequentially).

After a bit experimenting, I decided on the general structure for the whole multi-stage pipeline and told AI to fully implement it up for me.
In terms of code ownership, I'd say it's 50/50 (I own half, AI owns the half) - I have the general idea/understanding of how the whole multi-stage multi-pass rendering pipeline currently works, obviously.
I realized WebGPU/WGSL/shader stuff is not as easily learnable as many other stuff, lots of obscure API, low amount of examples. Given that I was not just porting GLSL shader but GLSL shaders integrated with mpv player, I decided to not spend too much time on this (not worth it for my goals) and use AI but with strict control over its output (strict review focused on GLSL+mpv setup parity).
