# Not Completed

## Features
- Better Analog Input UI
- Better Autocomplete/Linting
- Autosaving so that you do not loose code when browser refreshes



## Bug Fixes



# Completed

## Features
- Soft cursor movement
- Serial Plotter
- Enhanced Parsing
- Visualize the arduino board svg in transparent when simulation not running
- Ability to pause the running sketch
- Debug Console
- Batching of pin states: collect pin states with timestamps and send them together / decode in frontend
- Batching of serial messages / decode them in frontend
- Frontend rendering fpr serial output

## Bug Fixes
- Toggle visibility PWM button
- Multiple selections in example menu
- X-Button (output-panel) should be on the right side and the same button-style like the other icon-buttons
- PWM-Toggle-Button must be square like the other icon-buttons
- The margin of all button should be enlarged
- Example Menu: Only show one mared item (green) never more than one
- Example Menu: When opening a tree node, close other tree nodes!
- Pause/Resume functionality: digitalRead() returning wrong values, no serial output, timing frozen (Fixed: Added atomic pause state and offset tracking)
- PIN_MODE/PIN_VALUE messages triggering onError incorrectly
- Timing issue: delay(1000) in loop() needs 1200ms! (Fixed: removed stdin polling overhead from delay())
- Screenshots in README.md again with updated images (Fixed: Added 3 updated screenshots)
- Tables (IO-Registry and Debug): records hit header when scrolling. Header should be above the records not on them.
- When pinMode ist programmed twice or more for one pin, it should create a message in messages


