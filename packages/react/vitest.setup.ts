// React only takes `act`'s test-mode path when it knows it is under test; without
// this, updates are not guaranteed flushed when an assertion reads the DOM.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
