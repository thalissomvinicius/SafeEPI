const fs = require('fs');

let content = fs.readFileSync('src/components/ui/FaceCamera.tsx', 'utf8');

const target1 = `  // -- Face detection loop --\r\n  const handleVideoPlay = () => {\r\n    if (intervalRef.current) clearInterval(intervalRef.current)\r\n\r\n    intervalRef.current = setInterval(async () => {`;

const replacement1 = `  // -- Face detection loop --\r\n  const detectionLoopRef = useRef<() => Promise<void>>(async () => {})\r\n\r\n  useEffect(() => {\r\n    detectionLoopRef.current = async () => {`;

const target2 = `      }\r\n    }, 300)\r\n\r\n    return () => {\r\n      if (intervalRef.current) clearInterval(intervalRef.current)\r\n    }\r\n  }`;

const replacement2 = `      }\r\n    }\r\n  })\r\n\r\n  const handleVideoPlay = () => {\r\n    if (intervalRef.current) clearInterval(intervalRef.current)\r\n\r\n    intervalRef.current = setInterval(() => {\r\n      void detectionLoopRef.current()\r\n    }, 300)\r\n\r\n    return () => {\r\n      if (intervalRef.current) clearInterval(intervalRef.current)\r\n    }\r\n  }`;

// Since the file uses LF or CRLF, we'll replace the line endings to be safe
content = content.replace(/\r\n/g, '\n');
const t1 = target1.replace(/\r\n/g, '\n');
const r1 = replacement1.replace(/\r\n/g, '\n');
const t2 = target2.replace(/\r\n/g, '\n');
const r2 = replacement2.replace(/\r\n/g, '\n');

if (content.includes(t1) && content.includes(t2)) {
  content = content.replace(t1, r1);
  content = content.replace(t2, r2);
  fs.writeFileSync('src/components/ui/FaceCamera.tsx', content, 'utf8');
  console.log("Successfully replaced.");
} else {
  console.log("Targets not found.");
  if (!content.includes(t1)) console.log("Target 1 not found");
  if (!content.includes(t2)) console.log("Target 2 not found");
}
