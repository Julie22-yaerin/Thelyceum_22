#!/usr/bin/env node
/**
 * The thrift MCP server.
 *
 * Tools:
 *   read_lean      read a file, deduplicated against this session
 *   run_lean       run a command, compress its output
 *   check_loop     runaway loop interceptor (trips if action repeated > 2 times)
 *   compress_text  compress text the model already has in hand
 *   thrift_report  what has actually been saved, from the ledger
 */
export {};
