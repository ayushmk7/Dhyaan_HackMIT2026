// The front door. A real sign-in, as far as it goes: /auth/login looks the
// username up in the server's user store and checks the password against a
// stored hash, so a wrong name or a wrong password is a 401 and this screen
// shows the server's one sentence for both. What it hands back on success is
// still the one shared app key, so this is authentication without a session,
// and the note under the form says exactly that. The screen gates the app,
// holds a session, and signs out.
//
// Layout: the mark and the wordmark sit high and centred, the form directly
// under them. Nothing here is centred vertically; a sign-in form that floats
// in the middle of the screen reads as a splash page.
//
// The identifier is a username, not an email (the seeded account is `user`),
// so the field asks for one: default keyboard, no capitalisation, no
// autocorrect.
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Btn, Entrance, ErrorState, Field, Glass, Mark, Rule, Screen, Txt } from '@/components';
import { api } from '@/lib/api';
import { auth } from '@/lib/copy/auth';
import { radius, sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

export default function Login() {
  const signIn = useSession((s) => s.signIn);
  const onboarded = useSession((s) => s.onboarded);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (withUsername = username, withPassword = password) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(withUsername, withPassword);
      signIn(res.user, res.token, res.resident_id);
      router.replace(onboarded ? '/(family)/home' : '/onboard/welcome');
    } catch (e) {
      setError(e instanceof Error ? e.message : auth.errors.unreachable);
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
      <Entrance index={0} style={{ alignItems: 'center', marginTop: sp(2) }}>
        {/* Black plate, white mark: the one uncompromising note on a screen
            that is otherwise glass over atmosphere. */}
        <Mark size={72} />
        <Txt kind="hero" style={{ marginTop: sp(4), textAlign: 'center' }} accessibilityRole="header">
          {auth.appName}
        </Txt>
        <Rule style={{ alignSelf: 'stretch', marginTop: sp(3), marginHorizontal: sp(12) }} />
      </Entrance>

      {/* The door floats over the wash: the one glass surface here. */}
      <Entrance index={1} style={{ marginTop: sp(7) }}>
        <Glass radius={radius.sheet} lift="float" style={{ padding: sp(5), gap: sp(3) }}>
          <Field
            label={auth.identifierLabel}
            value={username}
            onChangeText={setUsername}
            placeholder={auth.identifierPlaceholder}
            keyboardType="default"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
          />
          <Field
            label={auth.passwordLabel}
            value={password}
            onChangeText={setPassword}
            placeholder={auth.passwordPlaceholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            onSubmitEditing={() => submit()}
          />
          {!!error && <ErrorState inline message={error} />}
          <Btn label={auth.submit} busy={busy} onPress={() => submit()} style={{ marginTop: sp(1) }} />
        </Glass>
      </Entrance>

      <Entrance index={2} style={{ marginTop: sp(5), alignItems: 'center', gap: sp(3) }}>
        <Btn
          kind="link"
          label={auth.demoShortcut}
          onPress={() => {
            setUsername(auth.demo.username);
            setPassword(auth.demo.password);
            submit(auth.demo.username, auth.demo.password);
          }}
          style={{ alignSelf: 'center' }}
        />
        <Txt kind="caption" tone="muted" style={{ textAlign: 'center', paddingHorizontal: sp(4) }}>{/* voice-ok */}
          {auth.note}
        </Txt>
      </Entrance>

      <View style={{ flex: 1 }} />
    </Screen>
  );
}
