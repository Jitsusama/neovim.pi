-- neovim-pi: public Lua API.
--
-- `require("neovim-pi").setup({ ... })` is the only
-- entry point the user calls. Everything else (RPC
-- client, buffer adapter, status cache) lives in
-- submodules and is opt-in.
--
-- Default config sets nothing up. The user (or another
-- plugin) opts into specific features:
--
--   require("neovim-pi").setup({
--     listen = "/run/user/1000/neovim-pi.sock",
--     buffers = { enable = true },
--     commands = { enable = true },
--   })

local M = {}

---@class neovim_pi.Config
---@field listen string?         Socket path to listen on (or nil for none).
---@field buffers { enable: boolean }?  Register `pi://` BufReadCmd.
---@field commands { enable: boolean }? Register `:PiAttach`, `:PiStatus`, etc.

---@type neovim_pi.Config
local config = {}

--- Configure neovim-pi. Idempotent; safe to call multiple times.
---@param opts neovim_pi.Config?
function M.setup(opts)
  config = vim.tbl_deep_extend("force", config, opts or {})

  if config.listen then
    require("neovim-pi.rpc").listen(config.listen)
  end

  if config.buffers and config.buffers.enable then
    require("neovim-pi.buffer").enable()
  end

  if config.commands and config.commands.enable then
    require("neovim-pi.commands").enable()
  end
end

--- Return the current config (a copy).
function M.config()
  return vim.deepcopy(config)
end

--- Returns true if a pi peer is currently attached.
function M.is_attached()
  return require("neovim-pi.rpc").is_attached()
end

--- Call a pi method by name. Async via a Lua callback.
---@param method string
---@param args any[]
---@param callback fun(err: any, result: any)
function M.call(method, args, callback)
  require("neovim-pi.rpc").call(method, args, callback)
end

return M
