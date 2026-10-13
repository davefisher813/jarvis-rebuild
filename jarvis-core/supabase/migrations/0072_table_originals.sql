-- Migration 0072: the user-files bucket keeps the original of an imported table
-- (issue #115, Notes templates slice 1).
--
-- A roster brought into a Team Sheet from Sheets or Excel is stored as it came,
-- beside the page it became, so the page is usable before its rows are brought
-- in and the file is still there after. 0020 limited the bucket to images and
-- PDF; this adds the four table types the import reads (CSV, TSV, plain text
-- for a paste, and XLSX). Additive only: the size limit, the path convention and
-- the three owner policies from 0020 are unchanged, and nothing already stored
-- is touched. The app asks for these types on the import path alone
-- (prepareUpload's table option), so a note attachment or an email attachment
-- still takes images and PDFs only.

update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg','image/png','image/heic','image/webp','application/pdf',
     'text/csv','text/tab-separated-values','text/plain',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
   ]
 where id = 'user-files';
