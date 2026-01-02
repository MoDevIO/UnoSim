# UnoSim
[![Supported OS](https://img.shields.io/badge/Supported%20OS-Linux%20%26%20macOS-blue?logo=refinedgithub&logoColor=white)](https://github.com/MoDevIO/UnoSim)
[![GitHub commit activity](https://img.shields.io/github/commit-activity/w/modevio/UnoSim?color=lightgreen&logo=git)](https://github.com/MoDevIO/UnoSim/commits)
<br>
[![Tests](https://img.shields.io/github/actions/workflow/status/MoDevIO/UnoSim/test-coverage.yml?label=Tests)](https://github.com/MoDevIO/UnoSim/actions/workflows/test-coverage.yml)
[![Test Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FMoDevIO%2FUnoSim%2Frefs%2Fheads%2Fgh-pages%2Fcoverage-summary.json&query=%24.statements.percent&suffix=%25&label=Test%20Coverage&color=purple)](https://modevio.github.io/UnoSim/)
<br>
[![Issues](https://img.shields.io/github/issues-raw/MoDevIO/UnoSim?color=orange)](https://github.com/MoDevIO/UnoSim/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr-raw/MoDevIO/UnoSim?color=cyan)](https://github.com/MoDevIO/UnoSim/pulls)


A web-based Arduino simulator that provides an interactive code editor, compilation and Arduino Preview for Arduino sketches directly in the browser.



## Preview
<p align="center">
   <img src="./screenshots/screenshot.png" alt="UnoSim Interface" width="48%" style="display:inline-block; margin-right:2%;" />
   <img src="./screenshots/screenshot_iotest.png" alt="UnoSim with Example loaded" width="48%" style="display:inline-block;" />
</p>
<p align="center">
   <img src="./screenshots/screenshot_addition.png" alt="alternative UnoSim Interface picture" width="48%" style="display:inline-block; margin-right:2%;" />
</p>


## Features
- **Code Editor**: Monaco editor integration for writing Arduino sketches with syntax highlighting
- **Compilation**: Compile Arduino code directly in the browser
- **Serial Monitor**: Real-time output display from simulated Arduino execution
- **Arduino Preview**: A preview of analog/digital inputs and outputs directly in the Arduino SVG
- **Web-based**: No installation required, run entirely in the browser
- **Modern UI**: Built with React and TailwindCSS for a responsive, professional interface


## Tech Stack
- **Frontend**: React, TypeScript, Vite, TailwindCSS, Radix UI
- **Backend**: Node.js (TypeScript), Express, WebSocket support
- **Storage**: In-memory storage (PostgreSQL/Neon infrastructure prepared but not integrated yet)
- **Editor**: Monaco Editor
- **Testing**: Jest with React Testing Library
- **Build Tools**: Vite, esbuild


## Installation (only for Linux/MacOS)
### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
### Setup

1. Clone the repository:
```bash
git clone https://github.com/MoDevIO/UnoSim.git
cd UnoSim
```

2. Install dependencies:
```bash
npm install
```

3. Start the dev-server:
```bash
npm run dev:full
```

This will start both the backend server and the frontend development server.


## License
MIT License - See [LICENSE](LICENSE) for details


## Contact & Support

### Getting Help
- **Issues & Bugs**: Use the [GitHub Issues](https://github.com/modevio/UnoSim/issues) tracker
- **Feature Requests**: Create an [Pull Request](https://github.com/modevio/UnoSim/pulls)
- **Questions**: Open a discussion or check existing issues

### Project Maintainers
- **Mo Tiltmann** (MoDevIO) - Couven-Gymnasium, Aachen
- **Tom Tiltmann** (ttbombadil) - Technische Hochschule, Köln


### Additional Resources
- [Arduino Official Documentation](https://www.arduino.cc/reference/)
- [Monaco Editor Documentation](https://microsoft.github.io/monaco-editor/)
- [React Documentation](https://react.dev/)
