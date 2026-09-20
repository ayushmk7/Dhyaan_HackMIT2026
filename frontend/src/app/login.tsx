// The front door. A faux sign-in: it looks and behaves like a real one, and it
// is honest about what it is. The backend's /auth/login validates an email
// shape and a non-empty password and hands back the shared demo key — there is
// no password store behind it, so this screen never claims your password was
// checked, and now says so on the screen rather than only in this comment. It
// gates the app, holds a session, and signs out.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Entrance, ErrorState, Field, Glass, Mark, Rule, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { radius, sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

const DEMO_EMAIL = 'priya@dhyaan.demo';

export default function Login() {
  const signIn = useSession((s) => s.signIn);
  const onboarded = useSession((s) => s.onboarded);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (withEmail = email, withPassword = password) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(withEmail, withPassword);
      signIn(res.user, res.token, res.resident_id);
      router.replace(onboarded ? '/(family)/home' : '/onboard/welcome');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t reach Dhyaan. Check your connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      keyboard
      wash
      style={{ paddingHorizontal: sp(5), flexGrow: 1 }}
      scrollProps={{ keyboardShouldPersistTaps: 'handled' }}
    >
      <Entrance index={0} style={{ alignItems: 'center', marginTop: sp(9) }}>
        {/* Black plate, white mark: the one uncompromising note on a screen
            that is otherwise glass over atmosphere. */}
        <Mark />
        <Txt kind="hero" style={{ marginTop: sp(5) }} accessibilityRole="header">
          Dhyaan
        </Txt>
        <Rule style={{ alignSelf: 'stretch', marginTop: sp(3), marginHorizontal: sp(10) }} />
      </Entrance>

      <View style={{ flex: 1, minHeight: sp(8) }} />

      {/* The door floats over the wash — the one glass surface here. */}
      <Entrance index={1}>
        <Glass radius={radius.sheet} lift="float" style={{ padding: sp(5), gap: sp(3) }}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={() => submit()}
          />
          {!!error && <ErrorState inline message={error} />}
          <Btn label="Sign in" busy={busy} onPress={() => submit()} />
          <Txt kind="caption" tone="muted">{/* voice-ok */}
            This sign-in checks that your email looks like an email. There is no
            password store behind it yet, so it is a door, not a lock.
          </Txt>
        </Glass>
      </Entrance>

      <Entrance index={2} style={{ marginTop: sp(5), alignItems: 'center', gap: sp(2) }}>
        <Btn
          kind="link"
          label="Use the demo account"
          onPress={() => {
            setEmail(DEMO_EMAIL);
            setPassword('demo');
            submit(DEMO_EMAIL, 'demo');
          }}
          style={{ alignSelf: 'center' }}
        />
      </Entrance>
    </Screen>
  );
}
