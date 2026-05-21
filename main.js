const { startServer } = require('./src/server');

const PORT = process.env.PORT || 3000;

startServer(PORT).then(() => {
  console.log('');
  console.log('  Record & Play is running!');
  console.log(`  Open: http://localhost:${PORT}`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
}).catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
