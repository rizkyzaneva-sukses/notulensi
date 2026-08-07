' Menjalankan start-yt-service.cmd tanpa jendela konsol.
'
' Task Scheduler menunjuk ke berkas ini, bukan langsung ke .cmd — kalau .cmd
' dipanggil langsung, jendela hitamnya nongkrong di taskbar selama service
' hidup. Pengawasan proses tetap ditangani .cmd itu sendiri, jadi tidak ada
' yang hilang dari cara ini.

Dim shell, fso, here
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here

' Argumen kedua 0 = sembunyikan jendela, ketiga False = jangan tunggu selesai.
shell.Run "cmd /c """ & here & "\start-yt-service.cmd""", 0, False
