/**
 * Recharts wrapper for the per-day analytics series.
 *
 * Plots registration, login-success, and login-failure counts over the
 * per-day interval start (x-axis) using a responsive line chart. Self-contained
 * and purely presentational: it takes the already-fetched `DailyBucket[]` series
 * and performs no data fetching of its own.
 *
 * Requirements: 15.4
 */

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DailyBucket } from '../api/types';

export interface ChartProps {
  /** Per-day analytics buckets to plot. */
  data: DailyBucket[];
}

export function Chart({ data }: ChartProps): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="intervalStart" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="registration"
          name="Registrations"
          stroke="#2563eb"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="loginSuccess"
          name="Login success"
          stroke="#16a34a"
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="loginFailure"
          name="Login failure"
          stroke="#dc2626"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default Chart;
