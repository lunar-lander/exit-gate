# Exit Gate - OpenSnitch Electron App

An Electron-based desktop application for monitoring network connections using OpenSnitch.

## Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Run linter
npm run lint

# Run type checker
npm run typecheck
```

## Architecture

- **Frontend**: React with TypeScript
- **Backend**: Electron main process with eBPF integration
- **Styling**: Tailwind CSS
- **State Management**: React hooks and context

## Key Features

- Real-time network connection monitoring
- Application-based connection tracking
- Domain-based statistics
- eBPF integration for system-level monitoring
- Responsive UI with charts and statistics