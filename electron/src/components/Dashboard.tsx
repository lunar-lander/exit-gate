import React from 'react';
import {
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  useTheme,
  Chip,
  Avatar,
  FormControl,
  Select,
  MenuItem,
  InputLabel,
} from '@mui/material';
import {
  CheckCircle,
  Cancel,
  Security,
  NetworkCheck,
  TrendingUp,
  Dns,
  Apps,
} from '@mui/icons-material';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
} from 'recharts';
import { Stats, HistoryEntry } from '../types';
import { format } from 'date-fns';

interface DashboardProps {
  stats: Stats;
  recentConnections: HistoryEntry[];
}

const Dashboard: React.FC<DashboardProps> = ({ stats, recentConnections }) => {
  const theme = useTheme();
  const [timeRange, setTimeRange] = React.useState('1h');

  React.useEffect(() => {
    const now = new Date();
    const since = new Date(now);

    switch (timeRange) {
      case '30m': since.setMinutes(now.getMinutes() - 30); break;
      case '1h': since.setHours(now.getHours() - 1); break;
      case '6h': since.setHours(now.getHours() - 6); break;
      case '12h': since.setHours(now.getHours() - 12); break;
      case '24h': since.setHours(now.getHours() - 24); break;
      case '7d': since.setDate(now.getDate() - 7); break;
      case '30d': since.setDate(now.getDate() - 30); break;
      default: since.setHours(now.getHours() - 1);
    }

    window.electron.getHistorySince(since.toISOString());
  }, [timeRange]);

  // Pastel colors derived from theme or custom
  const COLORS = {
    allowed: theme.palette.success.main, // #34d399
    denied: theme.palette.error.main,   // #f87171
    apps: theme.palette.primary.main,   // #818cf8
    domains: theme.palette.secondary.main, // #c084fc
    grid: 'rgba(255, 255, 255, 0.05)',
    text: theme.palette.text.secondary,
  };

  const pieData = [
    { name: 'Allowed', value: stats.allowed, color: COLORS.allowed },
    { name: 'Denied', value: stats.denied, color: COLORS.denied },
  ];

  // Aggregate data by application
  const appData = recentConnections.reduce((acc, conn) => {
    const app = conn.executable.split('/').pop() || conn.executable;
    acc[app] = (acc[app] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const appChartData = Object.entries(appData)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Aggregate data by domain
  const domainData = recentConnections.reduce((acc, conn) => {
    const domain = conn.dest_host || conn.dest_ip;
    acc[domain] = (acc[domain] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const domainChartData = Object.entries(domainData)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Custom Tooltip for Charts
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <Box
          sx={{
            bgcolor: 'background.paper',
            p: 1.5,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            boxShadow: theme.shadows[4],
          }}
        >
          <Typography variant="body2" color="text.primary" fontWeight="bold">
            {label}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {`${payload[0].value} connections`}
          </Typography>
        </Box>
      );
    }
    return null;
  };

  const StatCard = ({ title, value, icon, color }: any) => (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="body2" color="textSecondary" gutterBottom fontWeight="medium">
              {title}
            </Typography>
            <Typography variant="h3" fontWeight="bold" sx={{ color: color }}>
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              p: 1,
              borderRadius: 2,
              bgcolor: `${color}15`, // 15% opacity
              color: color,
              display: 'flex',
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  return (
    <Grid container spacing={3}>
      {/* Header with Time Selector */}
      <Grid item xs={12} display="flex" justifyContent="flex-end" alignItems="center">
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <Select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            displayEmpty
            inputProps={{ 'aria-label': 'Time Range' }}
            sx={{
              bgcolor: 'background.paper',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(255, 255, 255, 0.1)',
              },
            }}
          >
            <MenuItem value="30m">Last 30 Minutes</MenuItem>
            <MenuItem value="1h">Last Hour</MenuItem>
            <MenuItem value="6h">Last 6 Hours</MenuItem>
            <MenuItem value="12h">Last 12 Hours</MenuItem>
            <MenuItem value="24h">Last 24 Hours</MenuItem>
            <MenuItem value="7d">Last 7 Days</MenuItem>
            <MenuItem value="30d">Last 30 Days</MenuItem>
          </Select>
        </FormControl>
      </Grid>

      {/* Top Stats Row */}
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          title="Total Connections"
          value={stats.total_connections}
          icon={<NetworkCheck fontSize="large" />}
          color={theme.palette.primary.main}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          title="Allowed Traffic"
          value={stats.allowed}
          icon={<CheckCircle fontSize="large" />}
          color={theme.palette.success.main}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          title="Blocked Threats"
          value={stats.denied}
          icon={<Cancel fontSize="large" />}
          color={theme.palette.error.main}
        />
      </Grid>
      <Grid item xs={12} sm={6} md={3}>
        <StatCard
          title="Active Rules"
          value={stats.active_rules}
          icon={<Security fontSize="large" />}
          color={theme.palette.secondary.main}
        />
      </Grid>

      {/* Main Charts Section - Big Charts */}
      <Grid item xs={12} lg={8}>
        <Paper sx={{ p: 3, height: 500, display: 'flex', flexDirection: 'column' }}>
          <Box display="flex" alignItems="center" mb={2}>
            <Apps sx={{ mr: 1, color: COLORS.apps }} />
            <Typography variant="h6">Top Applications</Typography>
          </Box>
          <Box flexGrow={1} width="100%" height="100%">
            {appChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={appChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="name" stroke={COLORS.text} tick={{ fill: COLORS.text }} tickLine={false} axisLine={false} />
                  <YAxis stroke={COLORS.text} tick={{ fill: COLORS.text }} tickLine={false} axisLine={false} scale="log" domain={[1, 'auto']} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="count" fill={COLORS.apps} radius={[4, 4, 0, 0]} barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <Typography color="textSecondary">No application data available</Typography>
              </Box>
            )}
          </Box>
        </Paper>
      </Grid>

      <Grid item xs={12} lg={4}>
        <Paper sx={{ p: 3, height: 500, display: 'flex', flexDirection: 'column' }}>
          <Box display="flex" alignItems="center" mb={2}>
            <TrendingUp sx={{ mr: 1, color: COLORS.allowed }} />
            <Typography variant="h6">Traffic Distribution</Typography>
          </Box>
          <Box flexGrow={1} width="100%" height="100%" position="relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={120}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
             {/* Center Text Overlay */}
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -65%)', // Adjust for Legend
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              <Typography variant="h4" fontWeight="bold">
                {stats.total_connections}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Total Events
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Grid>

      {/* Domain Bar Chart (Secondary Large Chart) */}
      <Grid item xs={12}>
        <Paper sx={{ p: 3, height: 400, display: 'flex', flexDirection: 'column' }}>
           <Box display="flex" alignItems="center" mb={2}>
            <Dns sx={{ mr: 1, color: COLORS.domains }} />
            <Typography variant="h6">Top Domains</Typography>
          </Box>
          <Box flexGrow={1} width="100%" height="100%">
            {domainChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={domainChartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} horizontal={false} />
                  <XAxis type="number" stroke={COLORS.text} tick={{ fill: COLORS.text }} tickLine={false} axisLine={false} scale="log" domain={[1, 'auto']} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={150}
                    stroke={COLORS.text}
                    tick={{ fill: COLORS.text, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="count" fill={COLORS.domains} radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                <Typography color="textSecondary">No domain data available</Typography>
              </Box>
            )}
          </Box>
        </Paper>
      </Grid>

      {/* Recent Connections Log */}
      <Grid item xs={12}>
        <Paper sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
             <Typography variant="h6">Recent Activity</Typography>
          </Box>
          <List sx={{ p: 0, maxHeight: 400, overflow: 'auto' }}>
            {recentConnections.slice(0, 50).map((conn, index) => (
              <ListItem
                key={index}
                sx={{
                  borderLeft: '4px solid',
                  borderColor: conn.action === 'allow' ? 'success.main' : 'error.main',
                  bgcolor: index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <Box sx={{ minWidth: 80 }}>
                    <Chip
                      label={conn.action.toUpperCase()}
                      size="small"
                      color={conn.action === 'allow' ? 'success' : 'error'}
                      variant="outlined"
                      sx={{ fontWeight: 'bold', fontSize: '0.7rem', height: 24 }}
                    />
                  </Box>
                  
                  <Box sx={{ flexGrow: 1, ml: 2 }}>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                       {conn.executable.split('/').pop()}
                    </Typography>
                    <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                       {conn.dest_host || conn.dest_ip}:{conn.dest_port} ({conn.protocol})
                    </Typography>
                  </Box>

                  <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                    {format(new Date(conn.timestamp), 'HH:mm:ss')}
                  </Typography>
                </Box>
              </ListItem>
            ))}
            {recentConnections.length === 0 && (
              <ListItem>
                <ListItemText primary="No recent connections" secondary="Activity will appear here..." />
              </ListItem>
            )}
          </List>
        </Paper>
      </Grid>
    </Grid>
  );
};

export default Dashboard;