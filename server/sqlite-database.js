import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js/dist/sql-asm.js";

export async function createSqliteDatabase(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const SQL = await initSqlJs();
  const database = existsSync(resolvedPath)
    ? new SQL.Database(readFileSync(resolvedPath))
    : new SQL.Database();
  let transactionDepth = 0;
  let closed = false;

  return {
    exec(sql) {
      database.run(sql);
      persistIfReady();
    },
    pragma(value) {
      database.run(`PRAGMA ${value}`);
      persistIfReady();
    },
    prepare(sql) {
      return {
        run(...parameters) {
          database.run(sql, normalizeParameters(parameters));
          const result = { changes: database.getRowsModified() };
          persistIfReady();
          return result;
        },
        get(...parameters) {
          const statement = database.prepare(sql);
          try {
            statement.bind(normalizeParameters(parameters));
            return statement.step() ? statement.getAsObject() : undefined;
          } finally {
            statement.free();
          }
        },
        all(...parameters) {
          const statement = database.prepare(sql);
          const rows = [];
          try {
            statement.bind(normalizeParameters(parameters));
            while (statement.step()) rows.push(statement.getAsObject());
            return rows;
          } finally {
            statement.free();
          }
        }
      };
    },
    transaction(callback) {
      return (...parameters) => {
        database.run("BEGIN IMMEDIATE");
        transactionDepth += 1;
        try {
          const result = callback(...parameters);
          database.run("COMMIT");
          transactionDepth -= 1;
          persist();
          return result;
        } catch (error) {
          database.run("ROLLBACK");
          transactionDepth -= 1;
          throw error;
        }
      };
    },
    close() {
      if (closed) return;
      persist();
      database.close();
      closed = true;
    }
  };

  function persistIfReady() {
    if (!transactionDepth) persist();
  }

  function persist() {
    if (closed) return;
    const temporaryPath = `${resolvedPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, Buffer.from(database.export()));
    renameSync(temporaryPath, resolvedPath);
  }
}

function normalizeParameters(parameters) {
  return parameters.map((value) => value === undefined ? null : value);
}
