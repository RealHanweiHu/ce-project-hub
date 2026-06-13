import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface PhaseDistributionDatum {
  name: string;
  fullName: string;
  count: number;
  color: string;
  label: string;
}

interface PhaseDistributionChartProps {
  data: PhaseDistributionDatum[];
}

export function PhaseDistributionChart({ data }: PhaseDistributionChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: '#78716c' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: '#78716c' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#fff',
            border: '1px solid #e7e5e4',
            borderRadius: '2px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
          }}
          formatter={(value, _, props) => [
            `${value} 个项目`,
            data.find((item) => item.name === props.payload?.name)?.fullName || '',
          ]}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {data.map((entry, idx) => (
            <Cell key={idx} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
