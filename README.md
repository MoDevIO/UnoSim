# UnoWebSim

A web-based Arduino simulator that provides an interactive code editor, compilation, and execution environment for Arduino sketches directly in the browser.



## Features

- **Code Editor**: Monaco editor integration for writing Arduino sketches with syntax highlighting
- **Compilation**: Compile Arduino code directly in the browser
- **Serial Monitor**: Real-time output display from simulated Arduino execution
- **Web-based**: No installation required, run entirely in the browser
- **Modern UI**: Built with React and TailwindCSS for a responsive, professional interface
- **🔒 Docker Sandbox**: Secure code execution in isolated containers
- **🛡️ Security Hardened**: Helmet CSP, Rate Limiting, sanitized error messages

## Screenshots

![UnoWebSim Interface](./screenshot.png)

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, Radix UI
- **Backend**: Express, Node.js, WebSocket support
- **Storage**: In-Memory storage (PostgreSQL/Neon infrastructure prepared but not yet integrated)
- **Editor**: Monaco Editor
- **Testing**: Jest with React Testing Library
- **Build Tools**: esbuild, Vite
- **Security**: Helmet, express-rate-limit, Docker sandbox
- **Containerization**: Docker (Alpine-based sandbox)

## Installation

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Setup

1. Clone the repository:
```bash
git clone https://git-ce.rwth-aachen.de/assistance-systems/examples/unowebsim.git
cd unowebsim
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev:full
```

This will start both the backend server and the frontend development server concurrently.

## Usage

### Development

- **Full stack development** (frontend + backend):
  ```bash
  npm run dev:full
  ```

- **Backend only**:
  ```bash
  npm run dev
  ```

- **Frontend only**:
  ```bash
  npm run dev:client
  ```

### Building

```bash
npm run build
```

Builds both the frontend and backend for production.

### Production

```bash
npm start
```

### Testing

- Run tests:
  ```bash
  npm test 
  ```

- Run tests in watch mode:
  ```bash
  npm run test:watch
  ```

- Generate coverage report:
  ```bash
  npm run test:coverage
  ```

### Type Checking

```bash
npm run check
```

## Project Structure

```
unowebsim/
├── client/                          # Frontend React application
│   ├── src/
│   │   ├── App.tsx                  # Main React application
│   │   ├── main.tsx                 # Entry point
│   │   ├── index.css                # Global styles
│   │   ├── components/
│   │   │   ├── features/            # Feature components
│   │   │   │   ├── code-editor.tsx        # Monaco code editor
│   │   │   │   ├── compilation-output.tsx # Compiler output display
│   │   │   │   ├── serial-monitor.tsx     # Serial output display
│   │   │   │   └── sketch-tabs.tsx        # Sketch tab management
│   │   │   └── ui/                  # Reusable Radix UI components
│   │   ├── hooks/                   # Custom React hooks
│   │   ├── lib/                     # Utilities, API clients, helpers
│   │   └── pages/                   # Page components
│   └── index.html                   # HTML entry point
│
├── server/                          # Backend Express server
│   ├── index.ts                     # Server entry point (Helmet, Rate Limiting)
│   ├── routes.ts                    # API routes definition
│   ├── storage.ts                   # In-memory storage layer
│   ├── vite.ts                      # Vite SSR/client serving
│   ├── services/
│   │   ├── arduino-compiler.ts      # Arduino code compilation logic
│   │   ├── arduino-runner.ts        # Arduino code execution/simulation
│   │   └── sandbox-runner.ts        # 🔒 Docker sandbox runner (secure)
│   └── mocks/
│       └── arduino-mock.ts          # Mock Arduino runtime
│
├── docker/                          # Docker configuration
│   └── sandbox/
│       └── Dockerfile               # Alpine-based sandbox container
│
├── shared/                          # Shared code (client + server)
│   ├── logger.ts                    # Logging utilities
│   └── schema.ts                    # Shared data types/schemas
│
├── tests/                           # Test suites
│   └── server/
│       ├── services/
│       │   └── arduino-compiler.test.ts
│       ├── load-test-50-clients.test.ts
│       └── websocket-multi-client.test.ts
│
├── examples/                        # Example Arduino sketches
│   ├── example.ino                  # Basic example
│   └── complex.ino                  # Advanced example
│
├── coverage/                        # Test coverage reports
├── temp/                            # Temporary runtime files
├── dist/                            # Build output (generated)
│
├── Configuration files
│   ├── package.json                 # Dependencies & scripts
│   ├── tsconfig.json                # TypeScript configuration
│   ├── vite.config.ts               # Frontend build configuration
│   ├── jest.config.js               # Testing framework configuration
│   ├── tailwind.config.ts           # TailwindCSS theme
│   ├── postcss.config.js            # CSS processing
│   ├── drizzle.config.ts            # Database configuration
│   ├── components.json              # Shadcn/ui components
│   ├── .gitignore                   # Git ignore rules
│   └── README.md                    # This file
│
└── LICENSE                          # MIT License
```

## Key Components

### Code Editor
Monaco-based code editor for writing Arduino sketches with syntax highlighting and intelligent suggestions.

### Compilation Service
Handles compilation of Arduino code with support for standard Arduino libraries and error reporting.

### Docker Sandbox (Security)
User code runs in isolated Docker containers with strict resource limits:
- **Memory**: 128MB max
- **CPU**: 50% of one core
- **Timeout**: 60 seconds
- **Network**: Disabled
- **Filesystem**: Read-only, isolated temp directory

To enable the Docker sandbox:
```bash
# Build the sandbox image
npm run build:sandbox

# Start Docker daemon, then run the server
npm run dev
```

Without Docker, the system falls back to local g++ compilation (less secure).

### Serial Monitor
Displays real-time output from the simulated Arduino execution, mimicking the Arduino IDE's serial monitor.

## Getting Started for Contributors

### Development Environment Setup

1. **Clone and install**:
   ```bash
   git clone https://github.com/yourusername/unowebsim.git
   cd unowebsim
   npm install
   ```

2. **Start development servers**:
   ```bash
   npm run dev:full
   ```
   This launches:
   - Frontend on `http://localhost:5173`
   - Backend on `http://localhost:3000`

3. **Verify everything works**:
   ```bash
   npm run check          # TypeScript compilation
   npm run test           # Run all tests
   npm run test:coverage  # Check test coverage
   ```

4. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Code Quality Standards

- **TypeScript**: All code must be properly typed. No `any` types without justification.
- **Linting**: Follow ESLint rules (if configured)
- **Testing**: Write tests for new features. Aim for >80% coverage.
- **Format**: Use consistent formatting (Prettier if available)

### Before Submitting a PR

- Run `npm run check` to verify TypeScript compilation
- Run `npm test` to ensure all tests pass
- Update `README.md` if adding new features
- Keep commits atomic and well-described

## Deployment

### Prerequisites
- Node.js v18+ on your server
- npm or yarn
- (Optional) PostgreSQL/Neon database for persistent storage

### Deployment Steps

1. **Build for production**:
   ```bash
   npm run build
   ```
   This generates:
   - Frontend bundle in `dist/`
   - Backend bundle in `dist/index.js`

2. **Build the Docker sandbox** (recommended for security):
   ```bash
   npm run build:sandbox
   ```

3. **Set environment variables**:
   ```bash
   export NODE_ENV=production
   export PORT=3000
   # Optional: Disable rate limiting for testing
   # export DISABLE_RATE_LIMIT=true
   ```

4. **Start the production server**:
   ```bash
   npm start
   ```

5. **(Optional) Using a process manager** (e.g., PM2):
   ```bash
   npm install -g pm2
   pm2 start "npm start" --name "unowebsim"
   pm2 save
   pm2 startup
   ```

6. **Set up reverse proxy** (e.g., Nginx):
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

## Security

### Implemented Measures

- **Helmet**: Content Security Policy, X-Frame-Options, and other security headers
- **Rate Limiting**: 100 requests per 15 minutes per IP (configurable)
- **Docker Sandbox**: User code runs in isolated containers
- **Error Sanitization**: Internal errors don't leak sensitive information
- **Input Validation**: Zod schema validation for all API inputs

### Security Configuration

| Feature | Environment Variable | Default |
|---------|---------------------|--------|
| Rate Limiting | `DISABLE_RATE_LIMIT` | Enabled |
| Docker Sandbox | Docker daemon running | Fallback to local |
| Test Mode | `NODE_ENV=test` | Rate limit disabled |

## Known Issues & Limitations

### Current Limitations

1. **No Persistent Storage**: Currently uses in-memory storage only. Data is lost on server restart.
   
2. **Limited Arduino Library Support**: Only core Arduino libraries are supported. Custom/external libraries may not work.

3. **Simulation Accuracy**: The simulator provides basic functionality but doesn't perfectly emulate all Arduino hardware behaviors.

4. **Single Sketch at a Time**: Only one sketch can be compiled/executed per session.

### Known Bugs

- WebSocket reconnection may fail under certain network conditions (workaround: page refresh)
- Large sketches (>10KB) may cause performance issues in the editor

### Planned Improvements

- [x] Docker Sandbox for secure code execution
- [x] Security hardening (Helmet, Rate Limiting)
- [ ] Extended library support
- [ ] Basic Arduino I/O Simulation

## Contributing Guidelines

### How to Contribute

1. **Report Issues**: Use GitHub Issues to report bugs or suggest features
2. **Submit PRs**: Fork the repo, create a branch, and submit a pull request
3. **Code Review**: All PRs require review before merging

### Contribution Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/description`
3. Make your changes
4. Write/update tests as needed
5. Run the test suite: `npm test && npm run check`
6. Commit with clear messages: `git commit -m "Add feature description"`
7. Push to your fork: `git push origin feature/description`
8. Open a Pull Request with a clear description

### PR Checklist

- [ ] Code follows project style
- [ ] Tests pass (`npm test`)
- [ ] TypeScript compilation succeeds (`npm run check`)
- [ ] README updated if needed
- [ ] No breaking changes (or clearly documented)
- [ ] Commits are atomic and well-described

### Areas for Contribution

- Bug fixes and performance improvements
- Documentation enhancements
- Additional test coverage
- UI/UX improvements
- Feature implementations from the planned improvements list

## License

MIT License - See LICENSE file for details

## Contact & Support

### Getting Help

- **Issues & Bugs**: Use the [GitHub Issues](https://github.com/yourusername/unowebsim/issues) tracker
- **Feature Requests**: Create an issue with the `enhancement` label
- **Questions**: Open a discussion or check existing issues

### Contact Information

- **Project Maintainer**: ttbombadil
- **Email**: 248030666+ttbombadil@users.noreply.github.com

### Additional Resources

- [Arduino Official Documentation](https://www.arduino.cc/reference/)
- [Monaco Editor Documentation](https://microsoft.github.io/monaco-editor/)
- [React Documentation](https://react.dev/)

---

**Thank you for your interest in UnoWebSim! We look forward to your contributions.** 🚀
