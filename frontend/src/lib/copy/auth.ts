// Sign-in copy. The identifier is a username, not an email: the seeded demo
// account is `user` / `password`, and the server looks it up by name.

export const auth = {
  appName: 'Dhyaan',

  identifierLabel: 'Username',
  identifierPlaceholder: 'user',
  passwordLabel: 'Password',
  passwordPlaceholder: 'Your password',
  submit: 'Sign in',
  demoShortcut: 'Use the demo account',

  // What is true now: the password is checked against a stored hash. What is
  // still true: everyone who gets in shares one key afterwards.
  note: 'Your password is checked against the account on file. Everyone who signs in shares one app key after that.',

  // The seeded account the demo shortcut fills in.
  demo: { username: 'user', password: 'password' },

  errors: {
    enterUsername: 'Enter your username.',
    enterPassword: 'Enter your password.',
    // Same sentence for a wrong name and a wrong password, on purpose.
    badCredentials: 'Check your username and password.',
    unreachable: 'Couldn’t reach Dhyaan. Check your connection.',
  },
} as const;
