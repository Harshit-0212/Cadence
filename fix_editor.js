const fs = require('fs');
const path = 'c:\\Users\\heman\\HackInMotion-RICR-HIM-1131\\frontend\\src\\pages\\JourneyEditorCanvas.tsx';

let content = fs.readFileSync(path, 'utf8');

// Fix showToast({ message: X, type: 'Y' }) -> showToast(X, 'Y')
content = content.replace(/showToast\(\{ message: (.*?), type: '(success|error|info|warning)' \}\)/g, "showToast($1, '$2')");

// Fix useRef<HTMLInputElement>(null) for bgFileRef to avoid strict ref type error  
// Use a MutableRefObject workaround
content = content.replace(
  'const bgFileRef = useRef<HTMLInputElement>(null);',
  'const bgFileRef = useRef<HTMLInputElement | null>(null);'
);

// Fix the ref= usage on the input to use a callback ref or cast
content = content.replace(
  'ref={bgFileRef}',
  'ref={(el) => { bgFileRef.current = el; }}'
);

fs.writeFileSync(path, content, 'utf8');
console.log('Done. Fixed showToast calls and ref type.');
