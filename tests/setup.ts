import '@testing-library/jest-dom';

// Mock console.log to prevent CI failures from Logger output
// The Logger class in shared/logger.ts uses console.log() internally,
// and GitHub Actions fails on any console output during tests.
// This mock silently suppresses Logger output without affecting test behavior.
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});