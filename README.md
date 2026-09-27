# LoveNest

A small, private room for two. The app includes presence, encrypted chat and letters, a private photo album and shared memories timeline, synced YouTube listening, a shared drawing canvas, a constellation, a question jar, a two-player game, and voice calls.

## Run it

1. Install Node.js 20 or newer.
2. Open a terminal in this folder and run `npm install`.
3. Run `npm start`.
4. Open <http://localhost:3000> in a browser.
5. Both people enter the same secret phrase and their own name.

Names are remembered in that browser. The room history is kept in `data/rooms.json`, and encrypted photo attachments are stored separately in `data/attachments.json`. Photos are resized in your browser before they are encrypted and saved. Clearing both files removes saved room history and photos. Room identifiers, participant names, timestamps, and call setup signaling are visible to the server.

`http://localhost:3000` is suitable for trying the app in browsers on the computer running it. For another device, LoveNest needs an HTTPS address with a certificate trusted by that device. Set `TLS_KEY_PATH` and `TLS_CERT_PATH` before `npm start` to serve a local certificate, or deploy the app behind an HTTPS reverse proxy. Browsers require HTTPS (or `localhost`) for private browser storage and microphone access.

## Privacy

The shared phrase derives an AES-GCM key and room identifier in each browser. The server only receives the room identifier, participant names, call signaling, and encrypted room events. It cannot read the text, responses, photos, music links, or drawings. Choose a phrase that is hard to guess (several unrelated words work well); anyone who knows it can join the room. Data is stored by the server process without a backup. Voice audio uses WebRTC's encrypted browser-to-browser connection; call setup signaling passes through the room server.

## Deploying

The included `render.yaml` configures an always-on Node web service in Render's Frankfurt region, HTTPS, health checks, and a 1 GB persistent disk for room data. Render's Starter compute is currently $7/month and persistent disk storage is $0.25/GB/month, so this setup starts around $7.25/month plus any applicable bandwidth. Render's free web services don't support persistent disks, so they would lose room history after a restart or deploy. See [Render pricing](https://render.com/pricing) and [persistent disk docs](https://render.com/docs/disks).

To deploy, push this project to a private GitHub repository, then create a Render Blueprint from that repository and apply the `render.yaml` plan. Render provides a public `onrender.com` HTTPS address; the shared secret phrase keeps the couple's room private, so only share the address and phrase with each other. The server stores encrypted room history under `/var/data`. Add a TURN service in `public/app.js` if you want more reliable calling across strict networks.
"# project-sss" 
