"""Disposable Gedit fixture for the desktop integration test (requires pyatspi)."""
import json
import sys
import time
import pyatspi

def texts(node):
    try:
        if node.getRole() == pyatspi.ROLE_TEXT:
            yield node.queryText()
        for child in node:
            yield from texts(child)
    except Exception:
        pass

for app in pyatspi.Registry.getDesktop(0):
    if app.name != 'gedit':
        continue
    for window in app:
        if 'porvoz-selection-fixture.txt' not in window.name:
            continue
        for text in texts(window):
            if not text.obj.getState().contains(pyatspi.STATE_FOCUSED):
                continue
            if text.characterCount < 6:
                continue
            if sys.argv[1] == 'reset':
                text.obj.queryEditableText().setTextContents('Before ORIGINAL after')
                time.sleep(0.1)
                while text.getNSelections():
                    text.removeSelection(0)
                text.addSelection(7, 15)
                time.sleep(0.1)
            elif sys.argv[1] == 'select':
                text.setSelection(0, 7, 15) if text.getNSelections() else text.addSelection(7, 15)
                time.sleep(0.1)
            elif sys.argv[1] == 'clear':
                text.setCaretOffset(7)
            print(json.dumps({'text': text.getText(0, -1), 'selections': text.getNSelections()}))
            sys.exit(0)
raise RuntimeError('Disposable Gedit fixture not found')
