import { downloadXlsx, toCsv, type QueryResult } from "../lib/api";
import { Btn } from "./Layout";

export default function ResultTable({
  result,
  title,
}: {
  result: QueryResult;
  title: string;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8b97ad]">
        <span>
          строк {result.rows.length} · просмотрено узлов {result.scanned}
          {result.truncated ? " · выборка обрезана" : ""}
        </span>
        <div className="flex gap-2">
          <Btn
            kind="ghost"
            onClick={() => {
              const blob = new Blob([toCsv(result.columns, result.rows)], {
                type: "text/csv;charset=utf-8",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${title}.csv`;
              a.click();
            }}
          >
            CSV
          </Btn>
          <Btn kind="ghost" onClick={() => downloadXlsx(result.columns, result.rows, title)}>
            Excel
          </Btn>
        </div>
      </div>
      <div className="overflow-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-[#8b97ad]">
            <tr>
              {result.columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-t border-white/10">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 font-mono text-[13px]">
                    {cell === null ? "" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
