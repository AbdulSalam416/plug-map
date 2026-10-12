program model
  use netcdf
  integer :: ncid, status
  ! status = nf90_create("old.nc", NF90_CLOBBER, ncid)
  status = NF90_OPEN("forcing.nc", nf90_nowrite, ncid)
end program model
