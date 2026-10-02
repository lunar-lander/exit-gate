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
    FormControl,
    Select,
    MenuItem,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip as MuiTooltip,
    Button,
} from '@mui/material';
import {
    CheckCircle,
    Cancel,
    Security,
    NetworkCheck,
    TrendingUp,
    Dns,
    Apps,
    Help,
    Warning,
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
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
} from 'recharts';
import { DaemonStatus, DefaultAction, HistoryEntry, Stats } from '../types';
import { format } from 'date-fns';

interface DashboardProps {
    stats: Stats;
    recentConnections: HistoryEntry[];
    defaultAction: DefaultAction;
    onSetDefaultAction: (action: DefaultAction) => void;
    daemonStatus: DaemonStatus;
    onInstallDaemon: () => void;
}

const TIME_RANGES: Record<string, { label: string; ms: number; buckets: number; bucketMs: number }> = {
    '30m': { label: '30 minutes', ms: 30 * 60_000, buckets: 30, bucketMs: 60_000 },
    '1h': { label: 'hour', ms: 60 * 60_000, buckets: 30, bucketMs: 120_000 },
    '6h': { label: '6 hours', ms: 6 * 60 * 60_000, buckets: 24, bucketMs: 15 * 60_000 },
    '12h': { label: '12 hours', ms: 12 * 60 * 60_000, buckets: 24, bucketMs: 30 * 60_000 },
    '24h': { label: '24 hours', ms: 24 * 60 * 60_000, buckets: 24, bucketMs: 60 * 60_000 },
    '7d': { label: '7 days', ms: 7 * 24 * 60 * 60_000, buckets: 28, bucketMs: 6 * 60 * 60_000 },
    '30d': { label: '30 days', ms: 30 * 24 * 60 * 60_000, buckets: 30, bucketMs: 24 * 60 * 60_000 },
};

const Dashboard: React.FC<DashboardProps> = ({
    stats,
    recentConnections,
    defaultAction,
    onSetDefaultAction,
    daemonStatus,
    onInstallDaemon,
}) => {
    const theme = useTheme();
    const [timeRange, setTimeRange] = React.useState('1h');

    React.useEffect(() => {
        const range = TIME_RANGES[timeRange] || TIME_RANGES['1h'];
        window.electron.getHistorySince(new Date(Date.now() - range.ms).toISOString());
    }, [timeRange]);

    const COLORS = {
        allowed: theme.palette.success.main,
        denied: theme.palette.error.main,
        apps: theme.palette.primary.main,
        domains: theme.palette.secondary.main,
        grid: 'rgba(255, 255, 255, 0.05)',
        text: theme.palette.text.secondary,
    };

    const range = TIME_RANGES[timeRange] || TIME_RANGES['1h'];
    const rangeStartMs = Date.now() - range.ms;

    // Everything below reflects the selected time range so the cards, charts
    // and timeline always agree with each other.
    const filtered = React.useMemo(
        () => recentConnections.filter((c) => new Date(c.timestamp).getTime() >= rangeStartMs),
        [recentConnections, rangeStartMs]
    );

    const rangeStats = React.useMemo(() => {
        const apps = new Set<string>();
        const domains = new Set<string>();
        let allowed = 0;
        let denied = 0;
        for (const conn of filtered) {
            if (conn.action === 'allow') allowed += 1;
            else denied += 1;
            apps.add(conn.executable.split('/').pop() || conn.executable);
            domains.add(conn.dest_host || conn.dest_ip);
        }
        return { total: filtered.length, allowed, denied, apps: apps.size, domains: domains.size };
    }, [filtered]);

    // Activity timeline: bucketed allowed/denied counts across the window
    const timelineData = React.useMemo(() => {
        const { buckets, bucketMs } = range;
        const bucketsArr = Array.from({ length: buckets }, (_, i) => ({
            name: format(new Date(Date.now() - (buckets - i) * bucketMs), bucketMs >= 86_400_000 ? 'MMM d' : 'HH:mm'),
            allowed: 0,
            denied: 0,
        }));
        for (const conn of filtered) {
            const ts = new Date(conn.timestamp).getTime();
            const age = Date.now() - ts;
            if (age < 0) continue;
            const idx = buckets - 1 - Math.min(buckets - 1, Math.floor(age / bucketMs));
            if (conn.action === 'allow') bucketsArr[idx].allowed += 1;
            else bucketsArr[idx].denied += 1;
        }
        return bucketsArr;
    }, [filtered, range]);

    const pieData = [
        { name: 'Allowed', value: rangeStats.allowed, color: COLORS.allowed },
        { name: 'Denied', value: rangeStats.denied, color: COLORS.denied },
    ];

    // Aggregate data by application
    const appChartData = React.useMemo(() => {
        const appData = filtered.reduce((acc, conn) => {
            const app = conn.executable.split('/').pop() || conn.executable;
            acc[app] = (acc[app] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(appData)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([name, count]) => ({ name, count }));
    }, [filtered]);

    // Aggregate data by domain
    const domainChartData = React.useMemo(() => {
        const domainData = filtered.reduce((acc, conn) => {
            const domain = conn.dest_host || conn.dest_ip;
            acc[domain] = (acc[domain] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(domainData)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([name, count]) => ({ name, count }));
    }, [filtered]);

    // Custom Tooltip for Charts
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const total = payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0);
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
                    {payload.map((p: any) => (
                        <Typography key={p.dataKey} variant="body2" sx={{ color: p.color || p.fill }}>
                            {`${p.name}: ${p.value}`}
                        </Typography>
                    ))}
                    {payload.length > 1 && (
                        <Typography variant="body2" color="text.secondary">
                            {`Total: ${total}`}
                        </Typography>
                    )}
                </Box>
            );
        }
        return null;
    };

    const StatCard = ({ title, value, sub, icon, color }: any) => (
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
                        {sub && (
                            <Typography variant="caption" color="textSecondary">
                                {sub}
                            </Typography>
                        )}
                    </Box>
                    <Box
                        sx={{
                            p: 1,
                            borderRadius: 2,
                            bgcolor: `${color}15`,
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

    const rangeLabel = `last ${range.label}`;

    return (
        <Grid container spacing={3}>
            {/* Daemon offline banner */}
            {daemonStatus === 'disconnected' && (
                <Grid item xs={12}>
                    <Paper
                        sx={{
                            p: 2,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            borderColor: 'warning.main',
                            bgcolor: 'rgba(251,191,36,0.08)',
                        }}
                    >
                        <Warning color="warning" />
                        <Box sx={{ flexGrow: 1 }}>
                            <Typography variant="subtitle2" fontWeight={600}>
                                Daemon not connected
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Retrying every few seconds. If the daemon is not installed, use the
                                button on the right — the connection turns green automatically once it
                                is running.
                            </Typography>
                        </Box>
                        <Button variant="contained" size="small" onClick={onInstallDaemon}>
                            Install / repair daemon
                        </Button>
                    </Paper>
                </Grid>
            )}

            {/* Header: Default-mode toggle + Time Selector */}
            <Grid item xs={12} display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
                {/* Default action toggle */}
                <Box display="flex" alignItems="center" gap={1}>
                    <MuiTooltip
                        title={
                            defaultAction === 'allow'
                                ? 'Allow-by-default: all connections pass unless a Deny rule matches. Recommended — you monitor first, block later.'
                                : defaultAction === 'deny'
                                ? 'Deny-by-default: all connections are blocked unless an Allow rule matches'
                                : 'Prompt mode: ask for every connection that has no matching rule'
                        }
                    >
                        <Box display="flex" alignItems="center" gap={0.5} sx={{ cursor: 'default' }}>
                            <Help sx={{ fontSize: 16, color: 'text.secondary' }} />
                            <Typography variant="body2" color="text.secondary" fontWeight={600}>
                                Default:
                            </Typography>
                        </Box>
                    </MuiTooltip>
                    <ToggleButtonGroup
                        value={defaultAction}
                        exclusive
                        size="small"
                        onChange={(_e, val) => {
                            if (val) onSetDefaultAction(val as DefaultAction);
                        }}
                        sx={{
                            '& .MuiToggleButton-root': {
                                textTransform: 'none',
                                fontWeight: 600,
                                fontSize: '0.8rem',
                                px: 1.5,
                                py: 0.5,
                                borderColor: 'rgba(255,255,255,0.1)',
                                color: 'text.secondary',
                            },
                            '& .MuiToggleButton-root.Mui-selected[value="allow"]': {
                                color: 'success.main',
                                bgcolor: 'rgba(52,211,153,0.12)',
                            },
                            '& .MuiToggleButton-root.Mui-selected[value="deny"]': {
                                color: 'error.main',
                                bgcolor: 'rgba(248,113,113,0.12)',
                            },
                            '& .MuiToggleButton-root.Mui-selected[value="prompt"]': {
                                color: 'warning.main',
                                bgcolor: 'rgba(251,191,36,0.12)',
                            },
                        }}
                    >
                        <ToggleButton value="allow">
                            <CheckCircle sx={{ fontSize: 14, mr: 0.5 }} /> Allow All
                        </ToggleButton>
                        <ToggleButton value="prompt">
                            <Help sx={{ fontSize: 14, mr: 0.5 }} /> Prompt
                        </ToggleButton>
                        <ToggleButton value="deny">
                            <Cancel sx={{ fontSize: 14, mr: 0.5 }} /> Deny All
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>

                {/* Time range selector */}
                <FormControl size="small" sx={{ minWidth: 150 }}>
                    <Select
                        value={timeRange}
                        onChange={(e) => setTimeRange(e.target.value)}
                        displayEmpty
                        inputProps={{ 'aria-label': 'Time Range' }}
                        sx={{
                            bgcolor: 'background.paper',
                            '& .MuiOutlinedInput-notchedOutline': {
                                borderColor: 'rgba(255,255,255,0.1)',
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
                    title="Connections"
                    value={rangeStats.total}
                    sub={`${rangeStats.apps} apps · ${rangeStats.domains} destinations`}
                    icon={<NetworkCheck fontSize="large" />}
                    color={theme.palette.primary.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard
                    title="Allowed"
                    value={rangeStats.allowed}
                    sub={rangeLabel}
                    icon={<CheckCircle fontSize="large" />}
                    color={theme.palette.success.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard
                    title="Blocked"
                    value={rangeStats.denied}
                    sub={rangeLabel}
                    icon={<Cancel fontSize="large" />}
                    color={theme.palette.error.main}
                />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
                <StatCard
                    title="Active Rules"
                    value={stats.active_rules}
                    sub="configured on the daemon"
                    icon={<Security fontSize="large" />}
                    color={theme.palette.secondary.main}
                />
            </Grid>

            {/* Activity Timeline - the at-a-glance summary */}
            <Grid item xs={12}>
                <Paper sx={{ p: 3, height: 300, display: 'flex', flexDirection: 'column' }}>
                    <Box display="flex" alignItems="center" mb={2}>
                        <TrendingUp sx={{ mr: 1, color: COLORS.allowed }} />
                        <Typography variant="h6">Activity</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 1.5 }}>
                            {`connections over the last ${range.label}`}
                        </Typography>
                    </Box>
                    <Box flexGrow={1} width="100%" height="100%">
                        {rangeStats.total > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={timelineData} margin={{ top: 5, right: 30, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="gradAllowed" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={COLORS.allowed} stopOpacity={0.35} />
                                            <stop offset="95%" stopColor={COLORS.allowed} stopOpacity={0.02} />
                                        </linearGradient>
                                        <linearGradient id="gradDenied" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={COLORS.denied} stopOpacity={0.35} />
                                            <stop offset="95%" stopColor={COLORS.denied} stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        stroke={COLORS.text}
                                        tick={{ fill: COLORS.text, fontSize: 12 }}
                                        tickLine={false}
                                        axisLine={false}
                                        minTickGap={25}
                                    />
                                    <YAxis
                                        stroke={COLORS.text}
                                        tick={{ fill: COLORS.text, fontSize: 12 }}
                                        tickLine={false}
                                        axisLine={false}
                                        allowDecimals={false}
                                    />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Area
                                        type="monotone"
                                        dataKey="allowed"
                                        name="Allowed"
                                        stackId="1"
                                        stroke={COLORS.allowed}
                                        strokeWidth={2}
                                        fill="url(#gradAllowed)"
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="denied"
                                        name="Blocked"
                                        stackId="1"
                                        stroke={COLORS.denied}
                                        strokeWidth={2}
                                        fill="url(#gradDenied)"
                                    />
                                    <Legend verticalAlign="top" height={36} />
                                </AreaChart>
                            </ResponsiveContainer>
                        ) : (
                            <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                                <Typography color="textSecondary">
                                    No activity recorded in this period — traffic appears here as it happens
                                </Typography>
                            </Box>
                        )}
                    </Box>
                </Paper>
            </Grid>

            {/* Main Charts Section */}
            <Grid item xs={12} lg={8}>
                <Paper sx={{ p: 3, height: 420, display: 'flex', flexDirection: 'column' }}>
                    <Box display="flex" alignItems="center" mb={2}>
                        <Apps sx={{ mr: 1, color: COLORS.apps }} />
                        <Typography variant="h6">Top Applications</Typography>
                    </Box>
                    <Box flexGrow={1} width="100%" height="100%">
                        {appChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={appChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        stroke={COLORS.text}
                                        tick={{ fill: COLORS.text, fontSize: 11 }}
                                        tickLine={false}
                                        axisLine={false}
                                        interval={0}
                                        angle={-15}
                                        textAnchor="end"
                                        height={60}
                                    />
                                    <YAxis
                                        stroke={COLORS.text}
                                        tick={{ fill: COLORS.text }}
                                        tickLine={false}
                                        axisLine={false}
                                        domain={[0, 'auto']}
                                        allowDecimals={false}
                                    />
                                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'transparent' }} />
                                    <Bar dataKey="count" name="Connections" fill={COLORS.apps} radius={[4, 4, 0, 0]} barSize={40} />
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
                <Paper sx={{ p: 3, height: 420, display: 'flex', flexDirection: 'column' }}>
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
                                transform: 'translate(-50%, -65%)',
                                textAlign: 'center',
                                pointerEvents: 'none',
                            }}
                        >
                            <Typography variant="h4" fontWeight="bold">
                                {rangeStats.total}
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                                in {range.label}
                            </Typography>
                        </Box>
                    </Box>
                </Paper>
            </Grid>

            {/* Domain Bar Chart */}
            <Grid item xs={12}>
                <Paper sx={{ p: 3, height: 400, display: 'flex', flexDirection: 'column' }}>
                    <Box display="flex" alignItems="center" mb={2}>
                        <Dns sx={{ mr: 1, color: COLORS.domains }} />
                        <Typography variant="h6">Top Destinations</Typography>
                    </Box>
                    <Box flexGrow={1} width="100%" height="100%">
                        {domainChartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart
                                    data={domainChartData}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} horizontal={false} />
                                    <XAxis
                                        type="number"
                                        stroke={COLORS.text}
                                        tick={{ fill: COLORS.text }}
                                        tickLine={false}
                                        axisLine={false}
                                        domain={[0, 'auto']}
                                        allowDecimals={false}
                                    />
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
                                    <Bar
                                        dataKey="count"
                                        name="Connections"
                                        fill={COLORS.domains}
                                        radius={[0, 4, 4, 0]}
                                        barSize={20}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <Box display="flex" alignItems="center" justifyContent="center" height="100%">
                                <Typography color="textSecondary">No destination data available</Typography>
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
                        {filtered.slice(0, 50).map((conn, index) => (
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
                                        <Typography
                                            variant="caption"
                                            color="textSecondary"
                                            sx={{ fontFamily: 'monospace' }}
                                        >
                                            {conn.dest_host || conn.dest_ip}:{conn.dest_port} ({conn.protocol})
                                        </Typography>
                                    </Box>

                                    <Typography variant="caption" color="textSecondary" sx={{ fontFamily: 'monospace' }}>
                                        {format(new Date(conn.timestamp), 'HH:mm:ss')}
                                    </Typography>
                                </Box>
                            </ListItem>
                        ))}
                        {filtered.length === 0 && (
                            <ListItem>
                                <ListItemText
                                    primary="No recent connections"
                                    secondary="Activity will appear here..."
                                />
                            </ListItem>
                        )}
                    </List>
                </Paper>
            </Grid>
        </Grid>
    );
};

export default Dashboard;
