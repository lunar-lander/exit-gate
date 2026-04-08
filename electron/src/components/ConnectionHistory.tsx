import { Block, CheckCircle, Search } from '@mui/icons-material';
import {
    Box,
    Chip,
    InputAdornment,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TablePagination,
    TableRow,
    TextField,
    Typography,
} from '@mui/material';
import { format } from 'date-fns';
import React, { useState } from 'react';
import { HistoryEntry } from '../types';

interface ConnectionHistoryProps {
    history: HistoryEntry[];
}

const ConnectionHistory: React.FC<ConnectionHistoryProps> = ({ history }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);

    // Reset to first page whenever the underlying history list changes so we
    // never show a blank page after a bulk update truncates the entry count.
    React.useEffect(() => {
        setPage(0);
    }, [history]);

    const filteredHistory = history.filter((entry) => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return (
            entry.executable.toLowerCase().includes(search) ||
            entry.dest_ip.toLowerCase().includes(search) ||
            entry.dest_host?.toLowerCase().includes(search) ||
            entry.cmdline?.toLowerCase().includes(search)
        );
    });

    const paginatedHistory = filteredHistory.slice(
        page * rowsPerPage,
        page * rowsPerPage + rowsPerPage
    );

    const handleChangePage = (_: unknown, newPage: number) => {
        setPage(newPage);
    };

    const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
        setRowsPerPage(parseInt(event.target.value, 10));
        setPage(0);
    };

    return (
        <Box>
            <Box display="flex" flexDirection={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} mb={3}>
                <Typography variant="h5">Connection History</Typography>
                <TextField
                    size="small"
                    placeholder="Search connections..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <Search />
                            </InputAdornment>
                        ),
                    }}
                    sx={{ width: 300 }}
                />
            </Box>

            <TableContainer component={Paper}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Timestamp</TableCell>
                            <TableCell>Application</TableCell>
                            <TableCell>Destination</TableCell>
                            <TableCell>Protocol</TableCell>
                            <TableCell>Action</TableCell>
                            <TableCell>PID</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {paginatedHistory.map((entry) => (
                            <TableRow key={entry.id} hover sx={{ '& > *': { borderBottom: 'unset' } }}>
                                <TableCell sx={{ py: 1 }}>
                                    <Typography variant="body2">
                                        {format(new Date(entry.timestamp), 'HH:mm:ss')}
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary">
                                        {format(new Date(entry.timestamp), 'MM/dd')}
                                    </Typography>
                                </TableCell>
                                <TableCell sx={{ py: 1 }}>
                                    <Typography variant="body2" fontWeight="medium">
                                        {entry.executable.split('/').pop()}
                                    </Typography>
                                </TableCell>
                                <TableCell sx={{ py: 1 }}>
                                    <Typography variant="body2">
                                        {entry.dest_host || entry.dest_ip}:{entry.dest_port}
                                    </Typography>
                                </TableCell>
                                <TableCell sx={{ py: 1 }}>
                                    <Chip label={entry.protocol} size="small" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
                                </TableCell>
                                <TableCell sx={{ py: 1 }}>
                                    <Chip
                                        icon={entry.action === 'allow' ? <CheckCircle sx={{ fontSize: 14 }} /> : <Block sx={{ fontSize: 14 }} />}
                                        label={entry.action.toUpperCase()}
                                        color={entry.action === 'allow' ? 'success' : 'error'}
                                        size="small"
                                        sx={{ height: 20, fontSize: 10 }}
                                    />
                                </TableCell>
                                <TableCell sx={{ py: 1 }}>
                                    <Typography variant="caption" fontFamily="monospace">
                                        {entry.pid}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ))}
                        {paginatedHistory.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} align="center">
                                    <Typography color="textSecondary" py={4}>
                                        {searchTerm ? 'No matching connections found' : 'No connection history yet'}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
                <TablePagination
                    rowsPerPageOptions={[10, 25, 50, 100]}
                    component="div"
                    count={filteredHistory.length}
                    rowsPerPage={rowsPerPage}
                    page={page}
                    onPageChange={handleChangePage}
                    onRowsPerPageChange={handleChangeRowsPerPage}
                />
            </TableContainer>
        </Box>
    );
};

export default ConnectionHistory;
