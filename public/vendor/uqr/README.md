# Quiz Night

Quiz Night is a live, multiple-choice game. The host builds a quiz and shares a six-digit room code. Players join with a nickname and play on their own screens. Everyone sees the standings between questions.

## Run on a Mac

Install Node.js 20 or newer. Unzip the download, open Terminal in the extracted `quiz-night` folder and run these commands.

```sh
npm install
npm start
```

Open [localhost:3000](http://localhost:3000) on the Mac and select **Create a quiz**. To try a second player on the same Mac, open a new tab and choose **I have a code**. On the same Wi-Fi, other players can open `http://YOUR-MAC-IP:3000` on their devices and enter the code. You can find the Mac’s Wi-Fi IP address in its network settings.

## Update an existing copy

Copy the new `server.js` and the entire `public` folder into your existing project. From its root, restart the server with `npm start`, or redeploy your existing Node web service. Restart between games because restarting clears active rooms. For a first installation, use the whole extracted folder.

For a public game, run this project on a Node web service that supports WebSockets, with `npm install` as the install command and `npm start` as the start command. The server reads the host’s `PORT` environment variable. Players open that service’s public URL and enter the code. GitHub can store the source. GitHub Pages serves static files, while the live game requires the running Node server.

## Build a quiz

Each quiz supports up to 50 questions. Each question has its own settings.

- Write a prompt, add a picture, or use both. Pictures can be JPG, PNG or WebP, up to 12 MB per source file. The builder resizes them before upload. An optional description is available for screen readers.
- Enter four answer choices and select the correct one.
- Set the timer from 5 to 300 whole seconds. A new question starts at 20 seconds.
- Set the point multiplier from 0× to 10×, with up to two decimal places. The default is 1×. Use 0× for a practice round or 2× for double points.

Select **Create room**, share the code and choose **Start the quiz** when players have joined.

## Invite players with a QR code

Create a room and select **Project QR code** in the host lobby. Players scan the code with their phone camera, open the link, enter a nickname and join. The projector shows the six-digit code for anyone joining manually, plus a live player count. Select **Back to lobby** or press Escape when you are ready to start.

Choose **Download QR** for a PNG you can put on a slide or send to players. You can also share the join link displayed below the QR code. Each room gets its own invite. Creating another room from a saved quiz generates a new invite.

On a public website, the QR links to that site. If you host from `localhost` on your Mac, connect the phones to the same Wi-Fi. The lobby looks for your Mac’s network address automatically. If needed, open **Wi-Fi join address**, enter the address reachable from a phone (for example `http://192.168.1.10:3000`), and select **Update QR**.

## Save a quiz and host it again

Select **Save quiz** in the builder at any time, including while a question is unfinished. The **Saved in My quizzes** message confirms the save. You can close the tab, return to the same site in the same browser, and choose **My quizzes → Open quiz**. Save again after editing to update that copy. Choosing **Create room** also saves the questionnaire and opens a fresh game with a new room code and fresh scores.

The save keeps the quiz name, question order, prompts, all answer choices, correct answers, timers, point multipliers, pictures and picture descriptions. You can reuse it after a live room ends or the server restarts.

For a backup or another device, select **Download quiz file** in the builder or the host’s lobby or results screen. The resulting `.quiz.json` file includes the pictures and answer key. Open **My quizzes → Import quiz file** on the other device, choose the file, and you can edit or host it. Each import creates a separate copy on that device.

My quizzes uses this browser’s storage for this website. Clearing site data or ending a private browsing session can erase those copies. A downloaded quiz file remains available separately. If browser storage is unavailable, you can still download, import and host a quiz.

## Play and scoring

The round closes when everyone has answered, time runs out, or the host selects **Reveal answers**. Correct answers earn 500 to 1,000 base points according to how quickly the player answers. The server multiplies that amount by the question’s multiplier and rounds to a whole point. Skipped and incorrect answers earn zero.

The host and every player see the round leaderboard. A rocket shows how many places someone climbed and a parachute shows how many they dropped. Equal scores keep their previous order, using join order at the start of the game. The board displays ten players at a time. Players can browse every page and see their own rank even when it is outside the displayed page.

After the last round the host selects **See the winners**. Everyone sees the first-place player with confetti, and the winner sees **You won!**. Devices set to reduced motion show the same rankings and winner with static indicators.

Refreshing the same tab restores the host or player session, including an answer already submitted. The room allows two minutes to reconnect after a disconnection.

## Hosting capacity

A room is limited to 2,500 players. Game state and pictures live in memory in one Node process. Use a single server instance for this version. The live updates carry small leaderboard pages and picture URLs, and browsers can cache pictures.

In a local test, 2,001 simultaneous simulated players each fetched a question picture, submitted an answer and received the round and final standings. For a 2,000-person public event, verify concurrent connections, bandwidth for picture rounds and round transitions on the hosting plan and instance size you will use.
