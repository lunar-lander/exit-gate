import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  TextField,
  InputAdornment,
  TablePagination,
} from '@mui/material';
import { Search, CheckCircle, Block } from '@mui/icons-material';
import { HistoryEntry } from '../types';
import { format } from 'date-fns';

interface ConnectionHistoryProps {
  history: HistoryEntry[];
}

const ConnectionHistory: React.FC<ConnectionHistoryProps> = ({ history }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const filteredHistory = history.filter((entry) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      entry.executable.toLowerCase().includes(search) ||
      entry.dest_ip.toLowerCase().includes(search) ||
      entry.dest_host?.toLowerCase().includes(search) ||
      entry.cmdline.toLowerCase().includes(search)
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
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
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
        <Table>
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
              <TableRow key={entry.id} hover>
                <TableCell>
                  {format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm:ss')}
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2" fontWeight="medium">
                      {entry.executable.split('/').pop()}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      sx={{
                        display: 'block',
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.cmdline}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell>
                  <Box>
                    <Typography variant="body2">
                      {entry.dest_host || entry.dest_ip}:{entry.dest_port}
                    </Typography>
                    {entry.dest_host && (
                      <Typography variant="caption" color="textSecondary">
                        {entry.dest_ip}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip label={entry.protocol} size="small" variant="outlined" />
                </TableCell>
                <TableCell>
                  <Chip
                    icon={entry.action === 'allow' ? <CheckCircle /> : <Block />}
                    label={entry.action.toUpperCase()}
                    color={entry.action === 'allow' ? 'success' : 'error'}
                    size="small"
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" fontFamily="monospace">
                    {entry.pid}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    UID: {entry.uid}
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
