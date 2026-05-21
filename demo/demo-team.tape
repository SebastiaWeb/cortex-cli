Output demo/demo-team.gif

Set Shell "bash"
Set FontSize 15
Set Width 900
Set Height 540
Set Theme "Dracula"
Set Padding 24
Set TypingSpeed 55ms
Set PlaybackSpeed 1

Hide
Type "source /home/sebastiadev/Escritorio/cortex-cli/demo/demo-env.sh && clear"
Enter
Sleep 800ms
Show

Type "# ── Tech Lead: initialize team context ──────────────────"
Sleep 1.8s
Enter
Sleep 400ms
Type "cortex team init --repo https://github.com/acme/claude-config"
Sleep 500ms
Enter
Sleep 6s

Sleep 1.5s
Type "clear"
Enter
Sleep 300ms

Type "# ── New dev: one command installs everything ─────────────"
Sleep 1.8s
Enter
Sleep 400ms
Type "cortex install --repo https://github.com/acme/claude-config"
Sleep 500ms
Enter
Sleep 5s

Sleep 1.5s
Type "clear"
Enter
Sleep 300ms

Type "# ── Daily workflow: push your sessions, teammate pulls ───"
Sleep 1.8s
Enter
Sleep 400ms
Type "cortex team push"
Sleep 500ms
Enter
Sleep 3.5s

Sleep 800ms
Type "cortex team pull"
Sleep 500ms
Enter
Sleep 4s

Sleep 2s
