# The README demo. Run it with record.sh, which sets up DEMO_HOME and PI_CLI.
Output "frames/"

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Framerate 30
Set TypingSpeed 40ms

Hide
Type `export HOME="$DEMO_HOME" NPM_CONFIG_UPDATE_NOTIFIER=false && cd ~/acme-app && clear && node "$PI_CLI"`
Enter
Wait+Screen@20s /auto/
Show

Sleep 1s
Type "Run the tests, build it, and push to main."
Sleep 600ms
Enter

Wait+Screen@60s /asking you/
Sleep 3s
Type "n"
Sleep 400ms
Type "n"

Wait+Screen@20s /Skipped publishing/
Sleep 4s
