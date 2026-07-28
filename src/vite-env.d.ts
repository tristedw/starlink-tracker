/// <reference types="vite/client" />

// react-globe.gl doesn't ship its own types on some versions; fall back to `any`
// rather than block the build. Component usage is otherwise fully typed.
declare module 'react-globe.gl';
