const SyncRepository = require("./sync.repository");

class SyncController {
  async getLogs(req, res) {
    try {
      const limit = Math.min(Number(req.query.limit || 100), 1000);
      const data = await SyncRepository.getLogs(req.params.roomCode, limit);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(404).json({ success: false, message: err.message });
    }
  }

  async getSummary(req, res) {
    try {
      const data = await SyncRepository.getSummary(req.params.roomCode);
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(404).json({ success: false, message: err.message });
    }
  }

  async getOverview(req, res) {
    try {
      const data = await SyncRepository.getOverview();
      return res.json({ success: true, data });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  async exportLogs(req, res) {
    try {
      const roomCode = req.params.roomCode;
      const logs = roomCode 
        ? await SyncRepository.getLogs(roomCode, 2000)
        : await SyncRepository.getAllLogs(2000);

      const format = (req.query.format || "csv").toLowerCase();
      if (format === "json") {
        return res.json({ success: true, data: logs });
      }

      const headers = [
        "id",
        "room_id",
        "player_id",
        "sync_mode",
        "event_type",
        "delay_level",
        "artificial_delay_ms",
        "client_timestamp",
        "server_timestamp",
        "latency_ms",
        "predicted_score",
        "server_score",
        "score_difference",
        "reconciliation_required",
        "created_at"
      ];

      const csvRows = [headers.join(",")];
      logs.forEach((log) => {
        const row = [
          log.id || "",
          log.room_id || "",
          log.player_id || "",
          log.sync_mode || "",
          log.event_type || "",
          log.delay_level || "",
          log.artificial_delay_ms || 0,
          log.client_timestamp || "",
          log.server_timestamp || "",
          log.latency || 0,
          log.predicted_score || 0,
          log.server_score || 0,
          log.score_difference || 0,
          log.reconciliation_required ? "TRUE" : "FALSE",
          `"${log.created_at || new Date().toISOString()}"`
        ];
        csvRows.push(row.join(","));
      });

      const csvContent = csvRows.join("\n");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="sync-metrics-${roomCode || "all"}-${Date.now()}.csv"`);
      return res.send(csvContent);
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
}

module.exports = new SyncController();
