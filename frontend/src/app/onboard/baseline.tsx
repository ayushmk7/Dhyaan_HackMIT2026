// The cold-start prior (§8.4): five questions, chips not forms.
import { router } from 'expo-router';
import { View } from 'react-native';
import { Btn, Chip, Row, Screen, Txt } from '@/components';
import { sp } from '@/theme/tokens';
import { useSession } from '@/store/session';

function Question({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: sp(6) }}>
      <Txt kind="label" style={{ marginBottom: sp(2) }}>{label}</Txt>
      <Row gap={2} style={{ flexWrap: 'wrap' }}>{children}</Row>
    </View>
  );
}

export default function Baseline() {
  const { residentName, baseline, setBaseline } = useSession();

  return (
    <Screen>
      <Txt kind="title">Tell us about {residentName}</Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: sp(2) }}>
        Kestrel starts from your answers, then learns her real rhythm within a week.
      </Txt>

      <Question label="When is she usually up?">
        {['5:30', '6:30', '7:30', 'Later'].map((w) => (
          <Chip key={w} label={w} selected={baseline.wake === w} onPress={() => setBaseline({ wake: w })} />
        ))}
      </Question>

      <Question label="Meals on a normal day">
        {[2, 3].map((n) => (
          <Chip key={n} label={`${n} meals`} selected={baseline.mealsPerDay === n} onPress={() => setBaseline({ mealsPerDay: n })} />
        ))}
      </Question>

      <Question label="Walks on a normal day">
        {[0, 1, 2].map((n) => (
          <Chip
            key={n}
            label={n === 2 ? '2 or more' : String(n)}
            selected={baseline.walksPerDay === n}
            onPress={() => setBaseline({ walksPerDay: n })}
          />
        ))}
      </Question>

      <Question label="Does she go outside most days?">
        <Chip label="Yes" selected={baseline.goesOutside} onPress={() => setBaseline({ goesOutside: true })} />
        <Chip label="No" selected={!baseline.goesOutside} onPress={() => setBaseline({ goesOutside: false })} />
      </Question>

      <Question label="Getting around">
        {['Steady on her feet', 'Uses a cane', 'Uses a walker'].map((m) => (
          <Chip key={m} label={m} selected={baseline.mobility === m} onPress={() => setBaseline({ mobility: m })} />
        ))}
      </Question>

      <View style={{ marginTop: sp(8) }}>
        <Btn label="Continue" onPress={() => router.push('/onboard/pair')} />
      </View>
    </Screen>
  );
}
