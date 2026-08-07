// 占位入口，Task 13 将替换为完整 renderer。
import { createRoot } from 'react-dom/client';
import React from 'react';

function App() {
  return <div>AI Workspace</div>;
}

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');
createRoot(container).render(<App />);
