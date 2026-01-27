# Not Completed

## Features
- Better Analog Input UI
- Better Autocomplete/Linting
- Autosaving


## Bug Fixes
- While a program is paused, the time isn`t paused
- Timing issue: delay(1000) in loop() needs 1200ms!

# Completed

## Features
- Soft cursor movement
- Serial Plotter
- Enhanced Parsing
- Visualize the arduino board svg in transparent when simulation not running
- Ability to pause the running sketch

## Bug Fixes
- Toggle visibility PWM button
- Multiple selections in example menu
- X-Button (output-panel) should be on the right side and the same button-style like the other icon-buttons
- PWM-Toggle-Button must be square like the other icon-buttons
- The margin of all button should be enlarged
- Example Menu: Only show one mared item (green) never more than one
- Example Menu: When opening a tree node, close other tree nodes!
- After pause/resume the I/O-Pins Input doesn`t work (Input) - digitalRead() returning wrong values after pause/resume
- PIN_MODE/PIN_VALUE messages triggering onError incorrectly
- No serial output after pause/resume


